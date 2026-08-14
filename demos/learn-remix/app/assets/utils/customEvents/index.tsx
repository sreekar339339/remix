import './immerEnvironment.ts'
import {
  type Draft,
  enableMapSet,
  enablePatches,
  freeze,
  type Patch,
  produceWithPatches,
} from 'immer'
import { createCustomEventsDescriptor, customEventsEvented } from './descriptor.tsx'
import { canonicalAddressSegment, isPropertyKey, type CustomEventsRuntimeEntry } from './runtime.ts'
import { reservedCustomEventsNames } from './types.ts'
import type {
  CustomEventsDescriptor,
  CustomEventsDefinition,
  CustomEventsEventedViews,
  CustomEventsFactoryArgs,
  CustomEventsEventMap,
  EventDetails,
  NormalizeCustomEventsDefinition,
  RememberedDeclaration,
  RememberedDescriptor,
  RememberedDetails,
  RememberedFold,
  RememberedFolds,
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
 * Creates a remembered descriptor: the `root` key declares the root event's
 * initial composite, and every other key declares an event as a recipe — a
 * `(detail, root) => void` fold that folds its detail into the composite, or
 * a recipe with fewer than two parameters (`(detail) => void` or `() => void`)
 * that declares a transient occurrence. Every property of the argument is an
 * event name: dispatching `root` (`dispatchEvent({ root: {...} })`) replaces
 * the whole composite.
 *
 * `customEvents({ root: { count: 0, label: 'idle' }, inc: (detail, root) => { root.count += detail } })`
 *
 * A fold that shares a root detail's name shadows the detail: dispatching the
 * name runs the recipe instead of the implicit replace-itself fold, so the
 * recipe owns the update. The detail's slice remains the read surface
 * (`on.<name>` reads its current value); only the write semantics change.
 *
 * Type the `root` key by hand: the composite's keys are user-defined, so
 * completion cannot suggest them (TypeScript cannot complete properties of an
 * argument that infers its own generic). Everything else — fold details and
 * drafts, `on.<name>` sources, and `dispatchEvent` inputs — infers from it.
 */
export function customEvents<
  Details extends RememberedDetails,
  Folds extends RememberedFolds<Details>,
>(declaration: { root: Details } & Folds): RememberedDescriptor<Details, Omit<Folds, 'root'>>
export function customEvents(declaration?: unknown): unknown {
  if (isRememberedDeclaration(declaration)) {
    return createRemembered(declaration)
  }
  return createCustomEventsDescriptor()
}

function isRememberedDeclaration(value: unknown): value is { root: EventDetails } & {
  readonly [Name: string]: RememberedFold<EventDetails, any>
} {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.hasOwn(value, 'root')
  )
}

type RememberedFoldFn<Held extends EventDetails> = (detail: unknown, root: Draft<Held>) => void

/** Creates a remembered descriptor from a root event declaration and fold events. */
function createRemembered<
  Details extends RememberedDetails,
  Folds extends RememberedFolds<Details>,
>(declaration: { root: Details } & Folds): RememberedDescriptor<Details, Omit<Folds, 'root'>> {
  let { root, ...folds } = declaration
  if (root === null || typeof root !== 'object' || Array.isArray(root)) {
    throw new TypeError('customEvents root must be an object of remembered details.')
  }
  for (let name of Object.keys(root)) {
    if (name === '*' || (reservedCustomEventsNames as readonly string[]).includes(name)) {
      throw new TypeError(`customEvents reserves the detail name "${name}".`)
    }
  }
  let snapshot = freeze(root, true) as EventDetails
  let foldFns = new Map<string, RememberedFoldFn<Details>>()
  for (let [name, fold] of Object.entries(folds)) {
    if (typeof fold !== 'function') {
      throw new TypeError(`customEvents expects a recipe as the fold for "${name}".`)
    }
    if ((reservedCustomEventsNames as readonly string[]).includes(name)) {
      throw new TypeError(`customEvents reserves "${name}" for its API.`)
    }
    // A recipe with fewer than two parameters declares a transient
    // occurrence: it fires its event with a detail (or none at all) and
    // forgets it, leaving the composite untouched. `foldEntry` falls through
    // to the plain occurrence entry for it.
    if (fold.length <= 1) continue
    foldFns.set(name, fold as RememberedFoldFn<Details>)
  }

  function foldEntry(type: string, detail: unknown) {
    // The root event replaces the whole composite: its detail is the model,
    // with the same validation the declaration applies to its seed.
    if (type === 'root') {
      if (detail === null || typeof detail !== 'object' || Array.isArray(detail)) {
        throw new TypeError('customEvents root must be an object of remembered details.')
      }
      for (let name of Object.keys(detail)) {
        if (name === '*' || (reservedCustomEventsNames as readonly string[]).includes(name)) {
          throw new TypeError(`customEvents reserves the detail name "${name}".`)
        }
      }
      let [nextSnapshot, patches] = produceWithPatches(snapshot, (draft) => {
        for (let key of Object.keys(draft)) {
          delete (draft as EventDetails)[key]
        }
        Object.assign(draft, detail)
      })
      let entries = entriesFromPatches(snapshot, nextSnapshot, patches)
      snapshot = nextSnapshot
      return entries
    }

    let foldFn = foldFns.get(type)
    if (foldFn) {
      let [nextSnapshot, patches] = produceWithPatches(snapshot, (draft) => {
        foldFn(detail, draft as Draft<Details>)
      })
      let entries: CustomEventsRuntimeEntry[] = []
      if (patches.length > 0) {
        entries = entriesFromPatches(snapshot, nextSnapshot, patches)
        snapshot = nextSnapshot
      }
      // The effect entry rides the same routes as its folded output so the
      // fan-out covers exactly the affected addresses.
      let addresses = entries.flatMap((entry) => entry.addresses ?? [])
      entries.unshift({
        type,
        detail,
        ...(addresses.length > 0 ? { addresses } : {}),
      })
      return entries
    }

    // A detail dispatch is the implicit fold that replaces itself.
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
  return events as unknown as RememberedDescriptor<Details, Omit<Folds, 'root'>>
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
    return []
  }
  let previous = previousState[rootKey]
  let next = nextState[rootKey]
  let addresses: Array<readonly unknown[]> = []

  let addAddress = (address: readonly unknown[] | undefined) => {
    if (!address) return
    let duplicate = addresses.some(
      (candidate) =>
        candidate.length === address.length &&
        candidate.every((segment, index) => Object.is(segment, address[index])),
    )
    if (!duplicate) {
      addresses.push(address)
    }
  }

  for (let patch of patches) {
    let addressCount = addresses.length
    let segments = (patch.path as unknown[]).slice(1)

    if (previous instanceof Set || next instanceof Set) {
      if (!Object.hasOwn(patch, 'value')) {
        addAddress([])
        continue
      }
      addAddress([canonicalAddressSegment(patch.value)])
      continue
    }

    let previousPath = resolvePatchPath(previousState, rootKey, segments)
    let nextPath = resolvePatchPath(nextState, rootKey, segments)

    addAddress(previousPath)
    addAddress(nextPath)
    if (addresses.length === addressCount) addAddress([])
  }
  return addresses
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
): CustomEventsRuntimeEntry[] {
  let patchesByKey = Map.groupBy(patches, ({ path }) => path[0] as string)
  let entries: CustomEventsRuntimeEntry[] = []
  for (let [key, keyPatches] of patchesByKey) {
    let addresses = normalizePatches(previousState, nextState, keyPatches)
    let nextValue = nextState[key]
    let previousOwner = previousState[key]

    if (isPrimitive(previousOwner) && isPrimitive(nextValue)) {
      addresses = [
        ...(previousOwner !== undefined && previousOwner !== null
          ? [ownerAddress(previousOwner)]
          : []),
        ...(nextValue !== undefined && nextValue !== null ? [ownerAddress(nextValue)] : []),
      ]
    }
    entries.push({ type: key, detail: nextValue, addresses })
  }
  return entries
}
