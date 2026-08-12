import './immerEnvironment.ts'
import {
  type Draft,
  enableMapSet,
  enablePatches,
  freeze,
  type Immutable,
  type Patch,
  produce,
  produceWithPatches,
} from 'immer'
import type { TypedEventTarget } from 'remix/ui'
import { createCustomEventsDescriptor, customEventsEvented } from './descriptor.tsx'
import {
  canonicalAddressSegment,
  type CustomEventsBatchRuntimeEntry,
  type CustomEventsEntryOp,
} from './runtime.ts'
import type {
  CustomEventsDescriptor,
  CustomEventsDefinition,
  CustomEventsEventedViews,
  CustomEventsFactoryArgs,
  CustomEventsEventMap,
  CustomEventsOptions,
  EventDetails,
  NativeDOMEventName,
  NormalizeCustomEventsDefinition,
  ReservedCustomEventsName,
  RetainedDescriptor,
  RetainedDescriptorBase,
  RetainedFolds,
  RetainedSeeds,
} from './types.ts'
import { isPropertyKey } from './eventSources.ts'
export type { CustomEventsEventMap } from './types.ts'

enablePatches()
enableMapSet()

/**
 * Event-aware intrinsic elements for any descriptor: `evented.<tag>` resolves
 * to the tag string itself at runtime, while the source props infer the event
 * map from the descriptor or store passed as `eventSource`.
 */
export const evented = customEventsEvented as unknown as CustomEventsEventedViews<
  EventDetails,
  never
>

type DescriptorWithStore<Events extends EventDetails> = CustomEventsDescriptor<Events> & {
  /**
   * Retains the supplied state entries as directly readable state. With no
   * declared definition the value infers the whole store; declared events
   * add occurrence payloads and widen `null`/`[]` entries.
   */
  store<Value extends EventDetails>(
    value: StateInput<Events, Value>,
  ): Store<
    StaticStoreEvents<Events, StaticStoreState<Events, Value>>,
    StaticStoreState<Events, Value>
  >
}

/** Creates a typed native-event descriptor, optionally declaring its events. */
export function customEvents<Definition extends CustomEventsDefinition = never>(
  ...args: CustomEventsFactoryArgs<Definition>
): DescriptorWithStore<NormalizeCustomEventsDefinition<Definition>>
/**
 * Creates a retained descriptor: a root composite event whose detail folds in
 * every held seed and effect event declared here.
 *
 * `customEvents({ count: 0, label: 'idle' }, { inc: (held, n) => ({ count: held.count + n }) })`
 */
export function customEvents<Seeds extends RetainedSeeds>(
  seeds: Seeds,
): RetainedDescriptorBase<Immutable<Seeds>, Seeds>
export function customEvents<Seeds extends RetainedSeeds, Folds extends RetainedFolds<Seeds>>(
  seeds: Seeds,
  folds: Folds,
): RetainedDescriptor<Seeds, Folds>
export function customEvents(first?: unknown, foldsArg?: unknown): unknown {
  if (isRetainedDeclaration(first)) {
    return createRetained(first, foldsArg as RetainedFolds<EventDetails> | undefined)
  }
  let descriptorOptions = first as CustomEventsOptions | undefined
  let descriptor = createCustomEventsDescriptor(descriptorOptions)
  return Object.assign(descriptor, {
    store(value: EventDetails) {
      if (descriptorOptions?.host) {
        throw new TypeError('customEvents store() supplies its own EventTarget host.')
      }
      return createStore(value)
    },
  })
}

function isRetainedDeclaration(value: unknown): value is EventDetails {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).some((key) => key !== 'host')
  )
}

const reservedSeedNames = new Set<string>(['create', 'dispatch', 'on', 'asHost', 'store'])

type RetainedFoldFn<Held extends EventDetails> = (
  held: Held,
  detail: unknown,
) => Partial<Held> | undefined

/** Creates a retained descriptor from held seeds and declared effect events. */
function createRetained<Seeds extends EventDetails, Folds extends RetainedFolds<Seeds>>(
  seeds: Seeds,
  folds?: Folds,
): RetainedDescriptor<Seeds, Folds> {
  for (let name of Object.keys(seeds)) {
    if (name === '*' || reservedSeedNames.has(name)) {
      throw new TypeError(`customEvents reserves the seed name "${name}".`)
    }
  }
  let snapshot = freeze(seeds, true) as EventDetails
  let target = new EventTarget()
  let foldFns = new Map<string, RetainedFoldFn<Seeds>>()
  if (folds !== undefined) {
    for (let [name, fold] of Object.entries(folds)) {
      foldFns.set(name, fold as RetainedFoldFn<Seeds>)
    }
  }

  function foldEntry(type: string, detail: unknown) {
    let foldFn = foldFns.get(type)
    if (foldFn) {
      let entries: CustomEventsBatchRuntimeEntry[] = []
      let partial = foldFn(snapshot as Seeds, detail)
      if (partial !== undefined && Object.keys(partial).length > 0) {
        let nextSnapshot = produce(snapshot, (draft) => {
          Object.assign(draft as EventDetails, partial)
        })
        let keyPatches = new Map<string, Patch[]>()
        for (let key of Object.keys(partial)) {
          let patches = diffKey(snapshot[key], (nextSnapshot as EventDetails)[key]).map(
            (patch) => ({ ...patch, path: [key, ...patch.path] }),
          )
          if (patches.length > 0) keyPatches.set(key, patches)
        }
        if (keyPatches.size > 0) {
          for (let [key, patches] of keyPatches) {
            let { addresses, ops } = normalizePatches(snapshot, nextSnapshot, patches)
            let previousValue = snapshot[key]
            let nextValue = (nextSnapshot as EventDetails)[key]
            if (isPrimitive(previousValue) && isPrimitive(nextValue)) {
              addresses = [
                ...(previousValue !== undefined && previousValue !== null
                  ? [ownerAddress(previousValue)]
                  : []),
                ...(nextValue !== undefined && nextValue !== null
                  ? [ownerAddress(nextValue)]
                  : []),
              ]
              ops = ['replace']
            }
            entries.push({
              type: key,
              detail: nextValue,
              addresses,
              ops,
            })
          }
          snapshot = nextSnapshot
        }
      }
      // The effect entry rides the same routes as its folded output so the
      // fan-out covers exactly the affected addresses.
      let addresses = entries.flatMap((entry) => entry.addresses ?? [])
      let ops = entries.flatMap((entry) => entry.ops ?? [])
      entries.unshift({
        type,
        detail,
        ...(addresses.length > 0 ? { addresses } : {}),
        ...(ops.length > 0 ? { ops } : {}),
      })
      return entries
    }

    if (Object.hasOwn(snapshot, type)) {
      let previousValue = snapshot[type]
      let nextSnapshot = produce(snapshot, (draft) => {
        ;(draft as EventDetails)[type] = detail
      })
      snapshot = nextSnapshot
      let addresses: readonly (readonly unknown[])[] = [[]]
      if (isPrimitive(previousValue) && isPrimitive(nextSnapshot[type])) {
        addresses = [
          ...(previousValue !== undefined && previousValue !== null
            ? [ownerAddress(previousValue)]
            : []),
          ...(nextSnapshot[type] !== undefined && nextSnapshot[type] !== null
            ? [ownerAddress(nextSnapshot[type])]
            : []),
        ]
      }
      return [
        {
          type,
          detail: (nextSnapshot as EventDetails)[type],
          addresses,
        },
      ]
    }
    return undefined
  }

  let events = createCustomEventsDescriptor<EventDetails, EventDetails>(
    { host: target },
    { owner: target, getState: () => snapshot, fold: foldEntry },
  )
  return events as unknown as RetainedDescriptor<Seeds, Folds>
}

type StateInput<
  Events extends EventDetails,
  Value extends EventDetails,
  InvalidKeys extends PropertyKey = Extract<
    keyof Value,
    ReservedCustomEventsName | NativeDOMEventName
  >,
> = [InvalidKeys] extends [never]
  ? Value
  : Value & {
      readonly __customEventsStateError: 'store() keys cannot overwrite its API or use native DOM event names.'
      readonly invalidKeys: InvalidKeys
    }

/** The state map of a store, widened by declared hints where provided. */
type StaticStoreState<
  Definition extends CustomEventsDefinition,
  Value extends EventDetails,
  Normalized extends EventDetails = NormalizeCustomEventsDefinition<Definition>,
> = {
  [Key in keyof Value as Key extends ReservedCustomEventsName | NativeDOMEventName
    ? never
    : Key]: Key extends keyof Normalized ? Normalized[Key] : Value[Key]
}

/** Declared occurrence payloads merged with held state keys. */
type StaticStoreEvents<
  Definition extends CustomEventsDefinition,
  State extends EventDetails,
  Normalized extends EventDetails = NormalizeCustomEventsDefinition<Definition>,
> = Omit<Normalized, keyof State> & Immutable<State>

/** The full event map of a store: occurrences plus held state keys. */
type StoreEvents<Events, State> = Omit<Events, keyof State> & Immutable<State>

/**
 * A state store: the event source graph, a `state` namespace that owns the
 * immutable snapshot and its updates, and a `host` for ordinary `EventTarget`
 * consumption.
 */
type Store<Events extends EventDetails, State extends EventDetails> = {
  readonly events: CustomEventsDescriptor<StoreEvents<Events, State>, Immutable<State>>
  readonly state: {
    /** The current immutable state snapshot. */
    readonly value: Immutable<State>
    update(recipe: (draft: Draft<State>) => undefined): void
  }
  /** The store's EventTarget host for ordinary consumption. */
  readonly host: TypedEventTarget<CustomEventsEventMap<StoreEvents<Events, State>>>
}

function resolvePatchPath(
  state: EventDetails,
  rootKey: string,
  segments: readonly unknown[],
): readonly unknown[] | undefined {
  let logicalPath: unknown[] = []
  let value = state[rootKey]
  for (let segment of segments) {
    if (value instanceof Map) {
      if (!value.has(segment)) return
      let item = value.get(segment)
      logicalPath.push(canonicalAddressSegment(segment))
      value = item
      continue
    }
    if (Array.isArray(value)) {
      if (typeof segment !== 'number' || !Object.hasOwn(value, segment)) {
        return
      }
      let item = value[segment]
      logicalPath.push(canonicalAddressSegment(segment))
      value = item
      continue
    }
    if (value !== null && typeof value === 'object') {
      if (!isPropertyKey(segment) || !Object.hasOwn(value, segment)) {
        return
      }
      logicalPath.push(segment)
      value = Reflect.get(value, segment)
      continue
    }
    return
  }
  return logicalPath
}

function normalizePatches(previousState: EventDetails, nextState: EventDetails, patches: Patch[]) {
  let rootKey = patches[0]?.path[0]
  if (typeof rootKey !== 'string') {
    return { addresses: [], ops: [] }
  }
  let previous = previousState[rootKey]
  let next = nextState[rootKey]
  let addresses: Array<readonly unknown[]> = []
  let ops: CustomEventsEntryOp[] = []
  let mapContainer = previous instanceof Map || next instanceof Map

  let addAddress = (address: readonly unknown[] | undefined, op: string) => {
    if (!address) return
    let duplicate = addresses.some(
      (candidate) =>
        candidate.length === address.length &&
        candidate.every((segment, index) => Object.is(segment, address[index])),
    )
    if (!duplicate) {
      addresses.push(address)
      ops.push(mapContainer && op === 'replace' ? 'mapReplace' : (op as CustomEventsEntryOp))
    }
  }

  for (let patch of patches) {
    let addressCount = addresses.length
    let segments = (patch.path as unknown[]).slice(1)
    let op = patch.op

    if (previous instanceof Set || next instanceof Set) {
      if (!Object.hasOwn(patch, 'value')) {
        addAddress([], op)
        continue
      }
      addAddress([canonicalAddressSegment(patch.value)], op)
      continue
    }

    let previousPath = resolvePatchPath(previousState, rootKey, segments)
    let nextPath = resolvePatchPath(nextState, rootKey, segments)

    addAddress(previousPath, op)
    addAddress(nextPath, op)
    if (addresses.length === addressCount) addAddress([], op)
  }
  return { addresses, ops }
}

function isPrimitive(value: unknown) {
  return value === null || typeof value !== 'object'
}

/** Diff-style patches for one held key, with Map/Set item granularity. */
function diffKey(previous: unknown, next: unknown): Patch[] {
  let segment = (value: unknown) => value as string | number
  function diffValue(prev: unknown, next: unknown, path: (string | number)[]): Patch[] {
    if (prev instanceof Map && next instanceof Map) {
      let patches: Patch[] = []
      for (let [key, prevValue] of prev) {
        if (next.has(key)) {
          if (next.get(key) !== prevValue) {
            patches.push(...diffValue(prevValue, next.get(key), [...path, segment(key)]))
          }
        } else {
          patches.push({ op: 'remove', path: [...path, segment(key)] })
        }
      }
      for (let [key, value] of next) {
        if (!prev.has(key)) {
          patches.push({ op: 'add', path: [...path, segment(key)], value })
        }
      }
      if (patches.length > 0) return patches
      return prev === next ? [] : [{ op: 'replace', path }]
    }
    if (prev instanceof Set && next instanceof Set) {
      let patches: Patch[] = []
      for (let value of prev) {
        if (!next.has(value)) patches.push({ op: 'remove', path: [...path, segment(value)] })
      }
      for (let value of next) {
        if (!prev.has(value)) {
          patches.push({ op: 'add', path: [...path, segment(value)], value })
        }
      }
      return patches
    }
    if (Array.isArray(prev) && Array.isArray(next)) {
      if (prev.length !== next.length) return [{ op: 'replace', path }]
      let patches: Patch[] = []
      for (let index = 0; index < prev.length; index++) {
        if (prev[index] !== next[index]) {
          patches.push(...diffValue(prev[index], next[index], [...path, index]))
        }
      }
      return patches
    }
    if (prev !== null && next !== null && typeof prev === 'object' && typeof next === 'object') {
      let patches: Patch[] = []
      for (let key of Reflect.ownKeys(prev)) {
        if (typeof key !== 'string') continue
        let prevValue = Reflect.get(prev, key)
        let nextValue = Reflect.get(next, key)
        if (!Object.is(prevValue, nextValue)) {
          patches.push(...diffValue(prevValue, nextValue, [...path, key]))
        }
      }
      for (let key of Reflect.ownKeys(next)) {
        if (typeof key !== 'string' || Object.hasOwn(prev, key)) continue
        patches.push({ op: 'add', path: [...path, key], value: Reflect.get(next, key) })
      }
      if (patches.length > 0) return patches
      return prev === next ? [] : [{ op: 'replace', path }]
    }
    return prev === next ? [] : [{ op: 'replace', path }]
  }
  return diffValue(previous, next, [])
}

function ownerAddress(value: unknown): readonly unknown[] {
  return [canonicalAddressSegment(value)]
}

function createStore(initialState: EventDetails) {
  let snapshot = freeze(initialState, true) as EventDetails
  let target = new EventTarget()

  function foldKey(type: string, detail: unknown) {
    if (!Object.hasOwn(snapshot, type)) return undefined
    let nextSnapshot = produce(snapshot, (draft) => {
      ;(draft as EventDetails)[type] = detail
    })
    snapshot = nextSnapshot
    return [
      {
        type,
        detail: nextSnapshot[type],
        addresses: [[]] as readonly (readonly unknown[])[],
      },
    ]
  }

  let events = createCustomEventsDescriptor<EventDetails, EventDetails>(
    { host: target },
    { owner: target, getState: () => snapshot, fold: foldKey },
  )
  let state = {
    get value() {
      return snapshot
    },
    update(recipe: (draft: Draft<EventDetails>) => void) {
      let [nextSnapshot, patches] = produceWithPatches(snapshot, (draft) => {
        let result = recipe(draft)
        if (result !== undefined) {
          throw new TypeError('State update recipes must be synchronous and return no value.')
        }
      })
      if (patches.length === 0) return

      let patchesByKey = Map.groupBy(patches, ({ path }) => path[0] as string)

      let entries: Array<Record<string, unknown>> = []
      for (let [key, keyPatches] of patchesByKey) {
        let { addresses, ops } = normalizePatches(snapshot, nextSnapshot, keyPatches)
        let nextValue = nextSnapshot[key]
        let previousOwner = snapshot[key]

        if (isPrimitive(previousOwner) && isPrimitive(nextValue)) {
          entries.push({
            [key]: {
              detail: nextValue,
              options: {
                addresses: [
                  ...(previousOwner !== undefined && previousOwner !== null
                    ? [ownerAddress(previousOwner)]
                    : []),
                  ...(nextValue !== undefined && nextValue !== null
                    ? [ownerAddress(nextValue)]
                    : []),
                ],
              },
            },
          })
          continue
        }

        entries.push({
          [key]: {
            detail: nextValue,
            options: { addresses, ops },
          },
        })
      }

      snapshot = nextSnapshot
      target.dispatchEvent((events.create as (...args: unknown[]) => Event)(entries))
    },
  }
  return {
    events,
    state,
    host: target,
  }
}
