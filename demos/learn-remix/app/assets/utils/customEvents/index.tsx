import './immerEnvironment.ts'
import {
  type Draft,
  enableMapSet,
  enablePatches,
  freeze,
  type Immutable,
  type Patch,
  produceWithPatches,
} from 'immer'
import { createCustomEventsDescriptor, customEventsEvented } from './descriptor.tsx'
import {
  canonicalAddressSegment,
  isPropertyKey,
  type CustomEventsBatchRuntimeEntry,
  type CustomEventsEntryOp,
} from './runtime.ts'
import { reservedCustomEventsNames } from './types.ts'
import type {
  CustomEventsDescriptor,
  CustomEventsDefinition,
  CustomEventsEventedViews,
  CustomEventsFactoryArgs,
  CustomEventsEventMap,
  EventDetails,
  NormalizeCustomEventsDefinition,
  RememberedDescriptor,
  RememberedDescriptorBase,
  RememberedFolds,
  RememberedSeeds,
} from './types.ts'
export type { CustomEventsEventMap } from './types.ts'

enablePatches()
enableMapSet()

/**
 * Event-aware intrinsic elements for any descriptor: `evented.<tag>` resolves
 * to the tag string itself at runtime, while the source props infer the event
 * map from the descriptor passed as `eventSource`.
 */
export const evented = customEventsEvented as unknown as CustomEventsEventedViews<
  EventDetails,
  never
>

/** Creates a typed native-event descriptor, optionally declaring its events. */
export function customEvents<Definition extends CustomEventsDefinition = never>(
  ...args: CustomEventsFactoryArgs<Definition>
): CustomEventsDescriptor<NormalizeCustomEventsDefinition<Definition>>
/**
 * Creates a remembered descriptor: a root composite event whose detail folds in
 * every remembered seed and fold event declared here.
 *
 * `customEvents({ count: 0, label: 'idle' }, { inc: (draft, n) => { draft.count += n } })`
 */
export function customEvents<Seeds extends RememberedSeeds>(
  seeds: Seeds,
): RememberedDescriptorBase<Immutable<Seeds>, Seeds>
export function customEvents<Seeds extends RememberedSeeds, Folds extends RememberedFolds<Seeds>>(
  seeds: Seeds,
  folds: Folds,
): RememberedDescriptor<Seeds, Folds>
export function customEvents(first?: unknown, foldsArg?: unknown): unknown {
  if (isRememberedDeclaration(first)) {
    return createRemembered(first, foldsArg as RememberedFolds<EventDetails> | undefined)
  }
  return createCustomEventsDescriptor()
}

function isRememberedDeclaration(value: unknown): value is EventDetails {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0
  )
}

const rememberedSeedNames = new Set<string>(reservedCustomEventsNames)

type RememberedFoldFn<Held extends EventDetails> = (draft: Draft<Held>, detail: unknown) => void

/** Creates a remembered descriptor from initial details and declared fold events. */
function createRemembered<Seeds extends EventDetails, Folds extends RememberedFolds<Seeds>>(
  seeds: Seeds,
  folds?: Folds,
): RememberedDescriptor<Seeds, Folds> {
  for (let name of Object.keys(seeds)) {
    if (name === '*' || rememberedSeedNames.has(name)) {
      throw new TypeError(`customEvents reserves the seed name "${name}".`)
    }
  }
  let snapshot = freeze(seeds, true) as EventDetails
  let foldFns = new Map<string, RememberedFoldFn<Seeds>>()
  if (folds !== undefined) {
    for (let [name, fold] of Object.entries(folds)) {
      foldFns.set(name, fold as RememberedFoldFn<Seeds>)
    }
  }

  function foldEntry(type: string, detail: unknown) {
    let foldFn = foldFns.get(type)
    if (foldFn) {
      let [nextSnapshot, patches] = produceWithPatches(snapshot, (draft) => {
        foldFn(draft as Draft<Seeds>, detail)
      })
      let entries: CustomEventsBatchRuntimeEntry[] = []
      if (patches.length > 0) {
        entries = entriesFromPatches(snapshot, nextSnapshot, patches)
        snapshot = nextSnapshot
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

    // A seed dispatch is the implicit fold that replaces itself.
    if (Object.hasOwn(snapshot, type)) {
      let [nextSnapshot, patches] = produceWithPatches(snapshot, (draft) => {
        ;(draft as EventDetails)[type] = detail
      })
      let entries = entriesFromPatches(snapshot, nextSnapshot, patches)
      snapshot = nextSnapshot
      return entries
    }
    return undefined
  }

  let events = createCustomEventsDescriptor<EventDetails, EventDetails>({
    getState: () => snapshot,
    fold: foldEntry,
  })
  return events as unknown as RememberedDescriptor<Seeds, Folds>
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

/** Builds per-key runtime entries from Immer patches, with scalar owner routes. */
function entriesFromPatches(
  previousState: EventDetails,
  nextState: EventDetails,
  patches: Patch[],
): CustomEventsBatchRuntimeEntry[] {
  let patchesByKey = Map.groupBy(patches, ({ path }) => path[0] as string)
  let entries: CustomEventsBatchRuntimeEntry[] = []
  for (let [key, keyPatches] of patchesByKey) {
    let { addresses, ops } = normalizePatches(previousState, nextState, keyPatches)
    let nextValue = nextState[key]
    let previousOwner = previousState[key]

    if (isPrimitive(previousOwner) && isPrimitive(nextValue)) {
      addresses = [
        ...(previousOwner !== undefined && previousOwner !== null
          ? [ownerAddress(previousOwner)]
          : []),
        ...(nextValue !== undefined && nextValue !== null ? [ownerAddress(nextValue)] : []),
      ]
      ops = ['replace']
    }
    entries.push({ type: key, detail: nextValue, addresses, ops })
  }
  return entries
}
