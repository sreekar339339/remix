import './immerEnvironment.ts'
import {
  createDraft,
  type Draft,
  enableMapSet,
  enablePatches,
  finishDraft,
  immerable,
  type Patch,
  setAutoFreeze,
} from 'immer'
import { EVENT_SOURCE } from 'remix/ui'
import { createCustomEventsDescriptor, customEventsEvented } from './descriptor.tsx'
import type { RememberedEventContext } from './descriptor.tsx'
import {
  ALL_EVENTS,
  canonicalAddressSegment,
  readPath,
  type CustomEventsRuntimeEntry,
} from './runtime.ts'
import type { EventSourceEvent, EventSourceProtocol } from 'remix/ui'
import type {
  CustomEventsDefined,
  CustomEventsEventedViews,
  EventDetails,
  EventsApi,
} from './types.ts'
import type { DetailsOf, HandlersOf } from './types.ts'
export type {
  CustomEventsDefined,
  CustomEventsEventMap,
  DetailsHandler,
  DetailsOf,
  EventMapFrom,
  EventsApi,
  EventsMapOf,
  EventsOf,
  HandlersOf,
} from './types.ts'

enablePatches()
enableMapSet()
// The produced composite stays mutable so the live model can mirror it
// without copying; reads are guarded by readonly types instead of runtime
// freezing.
setAutoFreeze(false)

/**
 * Event-aware intrinsic elements for any Events instance: `evented.<tag>`
 * resolves to the tag string itself at runtime, while the source props infer
 * the event map from the descriptor passed as `on`.
 */
export const evented = customEventsEvented as unknown as CustomEventsEventedViews<
  EventDetails,
  never
>

type RememberedFoldFn<Held extends EventDetails> = (
  detail: unknown,
  composite: Draft<Held>,
) => void | Promise<unknown>

/**
 * Dispatch deferrals shared by fold sessions: a dispatch during an
 * uncommitted session waits until the session's next flush, so it reads and
 * writes the committed composite. Drain runs deferred dispatches until the
 * queue is empty, covering dispatches deferred by nested recipes.
 */
function createDeferredQueue() {
  type Deferred = {
    run: () => Promise<void> | void
    resolve: () => void
    reject: (error: unknown) => void
  }
  let queue: Deferred[] = []
  return {
    defer(run: () => Promise<void> | void) {
      return new Promise<void>((resolve, reject) => {
        queue.push({ run, resolve, reject })
      })
    },
    drain() {
      if (queue.length === 0) return []
      let completions: Array<Promise<void>> = []
      while (queue.length > 0) {
        let pending = queue.splice(0)
        for (let { run, resolve, reject } of pending) {
          let completion = Promise.resolve(run())
          completion.then(resolve, reject)
          completions.push(completion)
        }
      }
      return completions
    },
  }
}

type DeferredQueue = ReturnType<typeof createDeferredQueue>

/** The live fold session, tracked for the descriptor's dispatch deferral. */
type FoldSessionRef = {
  current: {
    dirty: boolean
    /** True when a nested session committed over this one mid-flight. */
    stale?: boolean
    /** Commits the open draft now, so a nested session folds on top of
     * this session's mutations instead of superseding (discarding) them. */
    flushNow?: () => void
  } | undefined
}

/** Cycle-detection threshold, not a loop bound — converging cascades are
 * unbounded; only genuinely non-converging reaction cycles trip this. */
const MAX_REACTION_FIRES = 100

/** Reactions indexed by their slice for O(1) lookup per dispatched entry. */
type ReactionIndex = { byKey: Map<string, Reaction[]>; wildcards: Reaction[] }

function buildReactionIndex(reactions: Reaction[]): ReactionIndex {
  let byKey = new Map<string, Reaction[]>()
  let wildcards: Reaction[] = []
  for (let reaction of reactions) {
    if (reaction.type === ALL_EVENTS) wildcards.push(reaction)
    else {
      let list = byKey.get(reaction.type)
      if (!list) byKey.set(reaction.type, (list = []))
      list.push(reaction)
    }
  }
  return { byKey, wildcards }
}

/** The work item the cross-fire scheduler processes per dispatched entry. */
type CrossFire = { reaction: Reaction; entry: CustomEventsRuntimeEntry }

/**
 * Runs a fold recipe against an open Immer draft session. Sync recipes
 * flush once when they return, carrying their entries in the same carrier
 * as the effect entry. Async recipes keep the draft open: the session
 * proxy schedules a flush at every access, so mutations between awaits
 * reach views at the next microtask boundary, and the returned settle
 * resolves after the recipe and all its flushes complete.
 */
function runFoldRecipe(
  foldFn: RememberedFoldFn<EventDetails>,
  type: string,
  detail: unknown,
  live: EventDetails,
  foldNames: ReadonlyMap<string, RememberedFoldFn<EventDetails>>,
  sessionRef: FoldSessionRef,
  deferred: DeferredQueue,
  dispatchEntries: (entries: CustomEventsRuntimeEntry[]) => Promise<unknown>,
  cross?: {
    /** Reactions indexed by slice, precomputed once per composite. */
    index: ReactionIndex
    /** Reactions already fired for this dispatch inside the recipe. */
    suppress?: Set<Reaction>
    /** Fires a reaction with reentry-abort signal semantics. */
    fire: (reaction: Reaction, receiver: unknown, event: EventSourceEvent) => unknown
    /** Async reaction runs fired during this dispatch; the session stays
     * open until they settle so their continuations keep committing. */
    runs: Promise<unknown>[]
  },
): { entries: CustomEventsRuntimeEntry[]; settle?: Promise<void> } {
  let reactionRuns = cross?.runs ?? []
  let previousSession = sessionRef.current
  let session: NonNullable<FoldSessionRef['current']> = { dirty: false }
  // A nested session reads the committed composite: flush any uncommitted
  // parent mutations first, so this session's draft opens on top of them
  // instead of superseding (discarding) them at the parent's next round.
  previousSession?.flushNow?.()
  // The parent's open draft is superseded either way — flag it so its next
  // round rebuilds from live instead of emitting phantom patches.
  if (previousSession) previousSession.stale = true
  sessionRef.current = session
  // The draft opens after the parent flush, so it mirrors the committed
  // composite including the mutations that flush just landed.
  let currentDraft = createDraft(live) as Draft<EventDetails>
  let active = true
  let flushScheduled = false
  let asyncMode = false
  let flushed: Array<Promise<unknown>> = []
  let sliceEntries: CustomEventsRuntimeEntry[] = []
  // The cross-fire worklist: each flush enqueues the reactions its entries
  // address, then processes them FIFO. Fired reactions mutate the fresh
  // draft, so cascades chain across follow-up rounds until a round commits
  // nothing new.
  let queue: CrossFire[] = []
  // Per-dispatch firing counts: converging cascades fire each reaction a
  // handful of times; the budget exists solely to turn runaway cycles into
  // a diagnosable error instead of an infinite loop.
  let fires = new Map<Reaction, number>()

  let flush = (): Array<Promise<void>> => {
    flushScheduled = false
    if (!active) return []
    // Finishing a clean draft is a no-op that returns the base, so the
    // flush needs no dirtiness probe.
    let patches: Patch[] = []
    let next = finishDraft(currentDraft, (patchList) =>
      patches.push(...patchList),
    ) as EventDetails
    currentDraft = createDraft(live) as Draft<EventDetails>
    session.dirty = false
    let entries: CustomEventsRuntimeEntry[] = []
    if (patches.length > 0) {
      entries = entriesFromPatches(live, next, patches)
      mirrorKeys(live, next, entries)
      if (asyncMode) flushed.push(dispatchEntries(entries))
      else sliceEntries.push(...entries)
    }
    // Every dispatched entry fires the reactions watching its slice against
    // the fresh draft — whether the write came from this event's own
    // dispatch or a cross-write from another reaction or fold. Routing
    // mirrors the view/effect trie: root reactions fire on any event of
    // their slice, deeper ones when an entry address reaches their path.
    // Reactions already fired for this dispatch in the recipe are
    // suppressed.
    if (cross && entries.length > 0) {
      for (let entry of entries) {
        let matched = [
          ...(cross.index.byKey.get(entry.type) ?? []),
          ...cross.index.wildcards,
        ]
        for (let reaction of matched) {
          if (cross.suppress?.has(reaction)) continue
          // Mirror the subscription trie: a reaction fires when its path
          // reaches along an entry address (change at or above it) or
          // extends one (change below it collects the branch).
          let routed =
            reaction.path.length === 0 ||
            (entry.addresses ?? []).some((address) => {
              let shared = address.length
              for (let i = 0; i < address.length && i < reaction.path.length; i++) {
                if (!Object.is(address[i], reaction.path[i])) {
                  shared = i
                  break
                }
              }
              return shared === address.length || shared === reaction.path.length
            })
          if (routed) queue.push({ reaction, entry })
        }
      }
      while (queue.length > 0) {
        let { reaction, entry } = queue.shift()!
        let count = (fires.get(reaction) ?? 0) + 1
        fires.set(reaction, count)
        if (count > MAX_REACTION_FIRES)
          throw new Error(
            `customEvents reaction cascade exceeded ${MAX_REACTION_FIRES} firings — possible cycle involving "${reaction.type}"`,
          )
        let currentAtPath = readPath(Reflect.get(currentDraft, entry.type), reaction.path)
        let returned = cross.fire(
          reaction,
          reaction.path.length === 0 ? sessionProxy : currentAtPath,
          { type: entry.type, detail: currentAtPath },
        )
        if (returned instanceof Promise) cross.runs.push(returned)
      }
    }
    // The session committed: run any dispatches deferred during it.
    let deferredCompletions = deferred.drain()
    if (asyncMode) flushed.push(...deferredCompletions)
    return deferredCompletions
  }
  session.flushNow = () => void flush()
  let scheduleFlush = () => {
    if (flushScheduled || !active) return
    flushScheduled = true
    queueMicrotask(flush)
  }
  // The session proxy stays stable across flushes while forwarding to the
  // current draft, which Immer revokes once finished. Fold names resolve to
  // the live dispatch wrappers: the Immer draft only mirrors enumerable own
  // properties, so the non-enumerable fold shadows would otherwise fall
  // through to the prototype recipe methods.
  let sessionProxy = new Proxy({} as object, {
    get(_target, property) {
      scheduleFlush()
      if (foldNames.has(property as string)) return Reflect.get(live, property)
      return Reflect.get(currentDraft, property)
    },
    set(_target, property, value) {
      scheduleFlush()
      session.dirty = true
      return Reflect.set(currentDraft, property, value)
    },
    has(_target, property) {
      scheduleFlush()
      return Reflect.has(currentDraft, property)
    },
    deleteProperty(_target, property) {
      scheduleFlush()
      session.dirty = true
      return Reflect.deleteProperty(currentDraft, property)
    },
  })

  // Sync sessions accumulate every generation into one carrier (an atomic
  // view update); async ones dispatch progressively per flush. A round that
  // commits nothing means the cascade has quiesced — the per-reaction fire
  // budget turns a never-quiescing cascade into an error before this loops
  // forever.
  let drain = (): Array<Promise<void>> => {
    let completions: Array<Promise<void>> = []
    while (true) {
      if (session.stale) {
        // A nested session committed over this one; drop the stale draft
        // (its generations were superseded) and continue from live.
        currentDraft = createDraft(live) as Draft<EventDetails>
        session.stale = false
      }
      completions.push(...flush())
      if (!session.dirty) break
    }
    return completions
  }

  let result = foldFn(detail, sessionProxy as Draft<EventDetails>)
  if (result instanceof Promise || reactionRuns.length > 0) {
    // An async recipe — or reactions whose continuations outlive the sync
    // body (an await-resumed `this.view = ...` write) — keeps the session
    // open: mutations between boundaries flush progressively, and the
    // settle resolves only after every run and its flushes complete.
    let entries: CustomEventsRuntimeEntry[]
    if (result instanceof Promise) {
      asyncMode = true
      entries = [{ type, detail }]
    } else {
      // The sync body commits its generations into one carrier; only the
      // continuation phase streams per flush.
      drain()
      entries = sliceEntries
      asyncMode = true
    }
    let settle = (async () => {
      await Promise.all([result, ...reactionRuns].filter(Boolean))
      // Cross-write reactions chain follow-up generations; drain them here
      // so every derived slice commits before the settle resolves.
      drain()
      active = false
      sessionRef.current = previousSession
      await Promise.all(flushed)
    })()
    return { entries, settle }
  }
  let deferredCompletions = drain()
  active = false
  sessionRef.current = previousSession
  if (deferredCompletions.length > 0) {
    return {
      entries: sliceEntries,
      settle: Promise.all(deferredCompletions).then(() => {}),
    }
  }
  return { entries: sliceEntries }
}

/**
 * A registered session reaction: its source's type and path, and the
 * callback the runner invokes inside the dispatch session with `this` bound
 * to the value at the path (or the session for the field itself).
 */
type Reaction = {
  type: string
  path: readonly unknown[]
  callback: (event: EventSourceEvent, signal?: AbortSignal) => unknown
}

/**
 * The reaction namespace over a descriptor's event sources: calling a source
 * with a callback registers a reaction instead of an element effect. Nested
 * accessors recurse, so deep paths register against the value at that
 * address.
 */
function createReactionNamespace(descriptorOn: object, reactions: Reaction[]): object {
  let wrapSource = (source: object): object =>
    new Proxy(source, {
      apply(_target, _thisArg, args) {
        let protocol = Reflect.get(_target, EVENT_SOURCE) as
          | (EventSourceProtocol & { path?: readonly unknown[] })
          | undefined
        if (protocol) {
          reactions.push({
            type: protocol.type,
            path: protocol.path ?? [],
            callback: args[0] as (event: EventSourceEvent) => unknown,
          })
          return undefined
        }
        let result = Reflect.apply(_target as (...args: unknown[]) => unknown, _thisArg, args)
        return result !== null &&
          (typeof result === 'object' || typeof result === 'function')
          ? wrapSource(result)
          : result
      },
      get(target, property, receiver) {
        let value = Reflect.get(target, property, receiver)
        if (
          property !== EVENT_SOURCE &&
          value !== null &&
          (typeof value === 'object' || typeof value === 'function')
        ) {
          return wrapSource(value)
        }
        return value
      },
    })
  return new Proxy(descriptorOn, {
    get(target, property, receiver) {
      if (property === '*') {
        return (callback: (event: EventSourceEvent) => unknown) => {
          reactions.push({ type: ALL_EVENTS, path: [], callback })
        }
      }
      let value = Reflect.get(target, property, receiver)
      return value !== null && typeof value === 'function' ? wrapSource(value) : value
    },
  })
}

/**
 * The shared fold dispatcher: fold recipes run through an Immer session,
 * and a field write with registered reactions runs as one session with the
 * implied slice write and the reactions' derivations in a single carrier.
 */
function createFoldEntry(args: {
  foldFns: Map<string, RememberedFoldFn<EventDetails>>
  live: () => EventDetails
  sessionRef: FoldSessionRef
  deferred: DeferredQueue
  reactions: Reaction[]
  context: RememberedEventContext
}): RememberedEventContext['fold'] {
  let { foldFns, live, sessionRef, deferred, reactions, context } = args

  // Reactions are registered during construction, after this runs — build
  // the slice index lazily on first dispatch. Reentry signals live for the
  // composite's lifetime: firing aborts the previous run of the same
  // reaction.
  let reactionIndex: ReactionIndex | undefined
  let reactionIndexFor = (): ReactionIndex =>
    (reactionIndex ??= buildReactionIndex(reactions))
  let reactionSignals = new Map<Reaction, AbortController>()

  // Writes from an aborted run are dropped at the receiver: a superseded
  // derivation's output is obsolete, so a stale continuation can never
  // clobber newer state. Reads stay live — callbacks still inspect state
  // after aborts — and dispatches (create/dispatchEvent) remain ungated for
  // intentional facts.
  function gateWrites(receiver: unknown, signal: AbortSignal): unknown {
    return new Proxy(receiver as object, {
      get: (target, property) => Reflect.get(target, property),
      set: (target, property, value) => {
        if (signal.aborted) return true
        return Reflect.set(target, property, value)
      },
      deleteProperty: (target, property) => {
        if (signal.aborted) return true
        return Reflect.deleteProperty(target, property)
      },
      defineProperty: (target, property, descriptor) => {
        if (signal.aborted) return true
        return Reflect.defineProperty(target, property, descriptor)
      },
    })
  }

  // A superseded run's rejection is expected noise: an aborted run or its
  // in-flight work rejecting with an abort error settles quietly instead of
  // rejecting the whole dispatch. Genuine failures still propagate.
  function trackRun(result: unknown, signal: AbortSignal): unknown {
    if (!(result instanceof Promise)) return result
    return result.catch((error) => {
      if (signal.aborted || (error as Error)?.name === 'AbortError') return
      throw error
    })
  }

  // An owned fire carries the signal of the run whose own write triggered
  // it — a run publishing back to its source folds that write inside its
  // own frame, and the matching refire is a cascade step of the living
  // run, not a stale one. Owned fires reuse the run's controller (whose
  // gate is open); every other re-fire aborts the previous signal so stale
  // work cancels itself.
  let fireWithSignal = (
    reaction: Reaction,
    receiver: unknown,
    event: EventSourceEvent,
    owner?: AbortSignal,
  ) => {
    let current = reactionSignals.get(reaction)
    if (owner !== undefined && owner === current?.signal) {
      let gated = gateWrites(receiver, current.signal)
      return trackRun(
        reaction.callback.call(gated, event, current.signal),
        current.signal,
      )
    }
    current?.abort()
    let controller = new AbortController()
    reactionSignals.set(reaction, controller)
    let gated = gateWrites(receiver, controller.signal)
    return trackRun(
      reaction.callback.call(gated, event, controller.signal),
      controller.signal,
    )
  }

  let runFieldReactions = (type: string, detail: unknown, owner?: AbortSignal) => {
    let index = reactionIndexFor()
    let fieldReactions = [
      ...(index.byKey.get(type) ?? []),
      ...index.wildcards,
    ]
    if (fieldReactions.length === 0 || !Object.hasOwn(live(), type)) return
    // Reactions fired here are suppressed at the flush, so the dispatch's
    // own writes don't re-trigger them.
    let fired = new Set<Reaction>()
    let runs: Array<Promise<unknown>> = []
    let session = runFoldRecipe(
      (value, draft) => {
        let previous = live()[type]
        if (!Object.is(previous, value)) draft[type] = value
        for (let reaction of fieldReactions) {
          let currentAtPath = readPath(draft[type], reaction.path)
          let previousAtPath = readPath(previous, reaction.path)
          let changed =
            reaction.path.length === 0
              ? !Object.is(previous, value)
              : !Object.is(previousAtPath, currentAtPath)
          if (!changed) continue
          fired.add(reaction)
          let returned = fireWithSignal(
            reaction,
            reaction.path.length === 0 ? draft : currentAtPath,
            { type, detail: currentAtPath },
            owner,
          )
          if (returned instanceof Promise) runs.push(returned)
        }
      },
      type,
      detail,
      live(),
      foldFns,
      sessionRef,
      deferred,
      (entries) => context.dispatchEntries!(entries),
      {
        index: reactionIndexFor(),
        suppress: fired,
        fire: (reaction, receiver, event) => fireWithSignal(reaction, receiver, event, owner),
        runs,
      },
    )
    let entries = session.entries
    let addresses = entries.flatMap((entry) => entry.addresses ?? [])
    entries.unshift({
      type,
      detail,
      ...(addresses.length > 0 ? { addresses } : {}),
    })
    if (session.settle) return { entries, settle: session.settle }
    return entries
  }

  return (type: string, detail: unknown, owner?: AbortSignal) => {
    let foldFn = foldFns.get(type)
    if (foldFn) {
      let runs: Array<Promise<unknown>> = []
      let session = runFoldRecipe(
        foldFn,
        type,
        detail,
        live(),
        foldFns,
        sessionRef,
        deferred,
        (entries) => context.dispatchEntries!(entries),
        {
          index: reactionIndexFor(),
          fire: (reaction, receiver, event) => fireWithSignal(reaction, receiver, event, owner),
          runs,
        },
      )
      let entries = session.entries
      // The effect entry rides the same routes as its folded output so the
      // fan-out covers exactly the affected addresses.
      let addresses = entries.flatMap((entry) => entry.addresses ?? [])
      entries.unshift({
        type,
        detail,
        ...(addresses.length > 0 ? { addresses } : {}),
      })
      if (session.settle) return { entries, settle: session.settle }
      return entries
    }

    // A function-valued own field that is not a fold (an arrow helper) is
    // dispatched as a transient occurrence, never a slice replace, so the
    // field survives.
    if (typeof (live() as Record<string, unknown>)[type] === 'function') {
      return [{ type, detail }]
    }

    // A detail dispatch is the implicit fold that replaces itself; a
    // field with registered reactions runs as one session first.
    if (Object.hasOwn(live(), type)) {
      let reacted = runFieldReactions(type, detail, owner)
      if (reacted) return reacted
      let previous = live()[type]
      if (Object.is(previous, detail)) return []
      live()[type] = detail
      return [{ type, detail, addresses: sliceAddresses(previous, detail) }]
    }
    return undefined
  }
}

/**
 * Defines a composite: `class GameEvents extends Events {}` plus
 * `GameEvents.define()`. The class carries only the static — its instance
 * side stays empty, so the composite keeps the subclass's own fields as
 * slices, its methods as fold recipes, and the constructor's `api`
 * registers session reactions (`api.on.<slice>(callback)`). The returned
 * object is the pure event surface; the model is read through views or
 * `events.details`.
 */
export class Events {
  static define<X extends object, Args extends unknown[]>(
    this: new (api: EventsApi<X>, ...args: Args) => X,
    ...args: Args
  ): CustomEventsDefined<X> {
    return defineEvents(this, ...args)
  }
}

function defineEvents<X extends object, Args extends unknown[]>(
  Class: new (api: EventsApi<X>, ...args: Args) => X,
  ...args: Args
): CustomEventsDefined<X> {
  let instance: X | undefined
  let live = (): EventDetails => instance as unknown as EventDetails

  // Collect the fold methods from the class prototype. The class is plain:
  // nothing is reserved, so every function is a fold recipe.
  let foldFns = new Map<string, RememberedFoldFn<EventDetails>>()
  let prototype = Class.prototype as { [key: string]: unknown }
  for (let name of Object.getOwnPropertyNames(prototype)) {
    if (name === 'constructor') continue
    let value = prototype[name]
    if (typeof value === 'function') {
      let method = value as (this: unknown, ...args: unknown[]) => unknown
      foldFns.set(
        name,
        ((detail, draft) => method.call(draft, detail)) as RememberedFoldFn<EventDetails>,
      )
    }
  }

  let sessionRef: FoldSessionRef = { current: undefined }
  let deferred = createDeferredQueue()
  let pendingSession = () => sessionRef.current?.dirty === true
  let occurrenceKeys = () => new Set<string>(foldFns.keys())
  let reactions: Reaction[] = []
  let context: RememberedEventContext = {
    getState: live,
    fold: () => undefined,
    pendingSession,
    deferDispatch: deferred.defer,
    occurrenceKeys,
  }
  context.fold = createFoldEntry({ foldFns, live, sessionRef, deferred, reactions, context })
  let descriptor = createCustomEventsDescriptor<EventDetails, EventDetails>(context)
  let api = {
    on: createReactionNamespace(descriptor.on as unknown as object, reactions),
    create: descriptor.create,
  } as unknown as EventsApi<X>

  instance = new Class(api, ...args)
  // Marks the instance draftable so fold recipes receive an Immer session
  // proxy. Non-enumerable so the composite spread stays model-only.
  Object.defineProperty(instance, immerable, { value: true })
  // Fold shadows: invoking a fold field dispatches the event under its name.
  for (let name of foldFns.keys()) {
    Object.defineProperty(instance, name, {
      value: (detail: unknown) => {
        void (descriptor.dispatchEvent as (input: never) => unknown)({ [name]: detail } as never)
      },
      writable: true,
      configurable: true,
    })
  }

  return descriptor as unknown as CustomEventsDefined<X>
}

/**
 * The routing of a slice write: scalar slices route by owner identity, Set
 * slices by the owner's address, and composite slices by their root.
 */
function sliceAddresses(previous: unknown, next: unknown): Array<readonly unknown[]> {
  if (isPrimitive(previous) && isPrimitive(next)) {
    let addresses: Array<readonly unknown[]> = []
    if (previous !== undefined && previous !== null) {
      addresses.push([canonicalAddressSegment(previous)])
    }
    if (next !== undefined && next !== null) {
      addresses.push([canonicalAddressSegment(next)])
    }
    return addresses
  }
  if (previous instanceof Set || next instanceof Set) {
    return [[canonicalAddressSegment(next)]]
  }
  return [[]]
}

/**
 * Mirrors the folded keys onto the live model at the top level, so the
 * instance a caller holds reads the current model. Keys without entries keep
 * their references (Immer shares untouched subtrees), so the assignments are
 * no-ops except for the folded keys.
 */
function mirrorKeys(live: EventDetails, next: EventDetails, entries: CustomEventsRuntimeEntry[]) {
  for (let entry of entries) {
    let key = entry.type
    if (Object.hasOwn(next, key)) live[key] = next[key]
    else {
      delete live[key]
    }
  }
}

function sameAddress(left: readonly unknown[], right: readonly unknown[]) {
  return (
    left.length === right.length && left.every((segment, index) => Object.is(segment, right[index]))
  )
}

function isPrimitive(value: unknown) {
  return value === null || typeof value !== 'object'
}

function appendAddress(addresses: Array<readonly unknown[]>, address: readonly unknown[]) {
  // Adjacent duplicates are the common case (a patch's previous and next
  // paths coincide), so compare against the last address before scanning.
  let last = addresses.at(-1)
  if (last && sameAddress(last, address)) return
  if (addresses.some((candidate) => sameAddress(candidate, address))) return
  addresses.push(address)
}

/**
 * Builds per-key runtime entries from Immer patches in one pass: each patch
 * canonicalizes to the address it affects under its top-level key, and every
 * key yields one entry carrying the slice's new value and its deduped routes.
 * Scalar slices route by owner identity instead.
 */
function entriesFromPatches(
  previousState: EventDetails,
  nextState: EventDetails,
  patches: Patch[],
): CustomEventsRuntimeEntry[] {
  let addressesByKey = new Map<string, Array<readonly unknown[]>>()
  for (let patch of patches) {
    let key = patch.path[0]
    if (typeof key !== 'string') continue
    let addresses = addressesByKey.get(key)
    if (!addresses) {
      addresses = []
      addressesByKey.set(key, addresses)
    }
    let previous = previousState[key]
    let next = nextState[key]
    if (previous instanceof Set || next instanceof Set) {
      // Set patches route by the added or removed value.
      if (Object.hasOwn(patch, 'value')) {
        appendAddress(addresses, [canonicalAddressSegment(patch.value)])
      } else {
        appendAddress(addresses, [])
      }
      continue
    }
    // Immer emits the raw path of every mutation it applied, so
    // canonicalizing the segments directly yields the same logical address
    // resolving the previous and next states would, without walking either.
    let address: unknown[] = []
    for (let index = 1; index < patch.path.length; index++) {
      address.push(canonicalAddressSegment(patch.path[index]!))
    }
    appendAddress(addresses, address)
  }

  let entries: CustomEventsRuntimeEntry[] = []
  for (let [key, addresses] of addressesByKey) {
    let nextValue = nextState[key]
    let previousOwner = previousState[key]

    if (isPrimitive(previousOwner) && isPrimitive(nextValue)) {
      addresses = sliceAddresses(previousOwner, nextValue)
    }
    entries.push({ type: key, detail: nextValue, addresses })
  }
  return entries
}