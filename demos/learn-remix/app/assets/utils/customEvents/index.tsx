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
import type { CompositeOf, FoldsOf } from './types.ts'
export type {
  CompositeEvents,
  CompositeOf,
  CustomEventsDefined,
  CustomEventsEventMap,
  EventsApi,
  EventsMapOf,
  EventsOf,
  FoldsOf,
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
type FoldSessionRef = { current: { dirty: boolean } | undefined }

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
): { entries: CustomEventsRuntimeEntry[]; settle?: Promise<void> } {
  let currentDraft = createDraft(live) as Draft<EventDetails>
  let session = { dirty: false }
  let previousSession = sessionRef.current
  sessionRef.current = session
  let active = true
  let flushScheduled = false
  let asyncMode = false
  let flushed: Array<Promise<unknown>> = []
  let sliceEntries: CustomEventsRuntimeEntry[] = []

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
    if (patches.length > 0) {
      let entries = entriesFromPatches(live, next, patches)
      mirrorKeys(live, next, entries)
      if (asyncMode) flushed.push(dispatchEntries(entries))
      else sliceEntries.push(...entries)
    }
    // The session committed: run any dispatches deferred during it.
    let deferredCompletions = deferred.drain()
    if (asyncMode) flushed.push(...deferredCompletions)
    return deferredCompletions
  }
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

  let result = foldFn(detail, sessionProxy as Draft<EventDetails>)
  if (result instanceof Promise) {
    asyncMode = true
    let settle = (async () => {
      await result
      flush()
      active = false
      sessionRef.current = previousSession
      await Promise.all(flushed)
    })()
    return {
      // The handler event itself; its state updates route per flush.
      entries: [{ type, detail }],
      settle,
    }
  }
  let deferredCompletions = flush()
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
  callback: (event: EventSourceEvent) => unknown
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

  let runFieldReactions = (type: string, detail: unknown) => {
    let fieldReactions = reactions.filter(
      (reaction) => reaction.type === type || reaction.type === ALL_EVENTS,
    )
    if (fieldReactions.length === 0 || !Object.hasOwn(live(), type)) return
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
          reaction.callback.call(
            reaction.path.length === 0 ? draft : currentAtPath,
            { type, detail: currentAtPath },
          )
        }
      },
      type,
      detail,
      live(),
      foldFns,
      sessionRef,
      deferred,
      (entries) => context.dispatchEntries!(entries),
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

  return (type: string, detail: unknown) => {
    let foldFn = foldFns.get(type)
    if (foldFn) {
      let session = runFoldRecipe(
        foldFn,
        type,
        detail,
        live(),
        foldFns,
        sessionRef,
        deferred,
        (entries) => context.dispatchEntries!(entries),
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
      let reacted = runFieldReactions(type, detail)
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
 * `events.detail`.
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
    else delete live[key]
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