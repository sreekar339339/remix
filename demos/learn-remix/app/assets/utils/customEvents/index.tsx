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
import { canonicalAddressSegment, type CustomEventsEntryOp } from './runtime.ts'
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
export function customEvents(options?: unknown): unknown {
  let descriptorOptions = options as CustomEventsOptions | undefined
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

function ownerAddress(value: unknown): readonly unknown[] {
  return [canonicalAddressSegment(value)]
}

function createStore(initialState: EventDetails) {
  let snapshot = freeze(initialState, true) as EventDetails
  let target = new EventTarget()

  function foldKey(type: string, detail: unknown) {
    let nextSnapshot = produce(snapshot, (draft) => {
      ;(draft as EventDetails)[type] = detail
    })
    snapshot = nextSnapshot
    return {
      detail: nextSnapshot[type],
      addresses: [[]] as readonly (readonly unknown[])[],
    }
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
