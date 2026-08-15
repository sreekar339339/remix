import './immerEnvironment.ts'
import {
  type Draft,
  enableMapSet,
  enablePatches,
  type Patch,
  produceWithPatches,
  setAutoFreeze,
} from 'immer'
import { createCustomEventsDescriptor, customEventsEvented } from './descriptor.tsx'
import { canonicalAddressSegment, type CustomEventsRuntimeEntry } from './runtime.ts'
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

const reservedNames = new Set<string>(reservedCustomEventsNames)

enablePatches()
enableMapSet()
// Produced state stays mutable so the live seed can mirror it without
// copying; reads are guarded by readonly types instead of runtime freezing.
setAutoFreeze(false)

/**
 * Event-aware intrinsic elements for any descriptor: `evented.<tag>` resolves
 * to the tag string itself at runtime, while the source props infer the event
 * map from the descriptor passed as `on`.
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
 * The object passed as `root` is the live composite: every dispatch folds
 * into that same object in place, so a held reference reads the current model
 * (imperative consumers attach native listeners and re-read the seed). Read
 * values are readonly-typed, so views cannot mutate the model at compile time.
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
    if (name === '*' || reservedNames.has(name)) {
      throw new TypeError(`customEvents reserves the detail name "${name}".`)
    }
  }
  if (Object.isFrozen(root)) {
    throw new TypeError(
      'customEvents root must not be frozen so dispatches can update it in place.',
    )
  }
  // The seed object is the live composite: every dispatch folds into it and
  // mirrors its result back at the top level, so a holder of the seed reads
  // the current model. Reads are guarded by readonly types, not freezing.
  let live = root as EventDetails
  let foldFns = new Map<string, RememberedFoldFn<Details>>()
  for (let [name, fold] of Object.entries(folds)) {
    if (typeof fold !== 'function') {
      throw new TypeError(`customEvents expects a recipe as the fold for "${name}".`)
    }
    if (reservedNames.has(name)) {
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
      let next = detail as EventDetails
      for (let name of Object.keys(next)) {
        if (name === '*' || reservedNames.has(name)) {
          throw new TypeError(`customEvents reserves the detail name "${name}".`)
        }
      }
      let entries: CustomEventsRuntimeEntry[] = []
      for (let key of Object.keys(next)) {
        let previous = live[key]
        if (!Object.is(previous, next[key])) {
          entries.push(detailEntry(key, previous, next[key]))
          live[key] = next[key]
        }
      }
      for (let key of Object.keys(live)) {
        if (!Object.hasOwn(next, key)) {
          let previous = live[key]
          delete live[key]
          entries.push(
            previous instanceof Set
              ? { type: key, detail: undefined, addresses: [[]] }
              : detailEntry(key, previous, undefined),
          )
        }
      }
      return entries
    }

    let foldFn = foldFns.get(type)
    if (foldFn) {
      let [next, patches] = produceWithPatches(live, (draft) => {
        foldFn(detail, draft as Draft<Details>)
      })
      let entries: CustomEventsRuntimeEntry[] = []
      if (patches.length > 0) {
        entries = entriesFromPatches(live, next, patches)
        mirrorKeys(live, next, entries)
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
    if (Object.hasOwn(live, type)) {
      let previous = live[type]
      if (Object.is(previous, detail)) return []
      live[type] = detail
      return [detailEntry(type, previous, detail)]
    }
    return undefined
  }

  let events = createCustomEventsDescriptor<EventDetails, EventDetails>({
    getState: () => live,
    fold: foldEntry,
  })
  return events as unknown as RememberedDescriptor<Details, Omit<Folds, 'root'>>
}

/**
 * The runtime entry of a top-level key write, computed directly from the
 * previous and next values: primitives route by owner identity, Sets by the
 * new value, and everything else by the whole-key route.
 */
function ownerAddresses(previous: unknown, detail: unknown) {
  let addresses: Array<readonly unknown[]> = []
  if (previous !== undefined && previous !== null) {
    addresses.push([canonicalAddressSegment(previous)])
  }
  if (detail !== undefined && detail !== null) {
    addresses.push([canonicalAddressSegment(detail)])
  }
  return addresses
}

function detailEntry(type: string, previous: unknown, detail: unknown): CustomEventsRuntimeEntry {
  if (isPrimitive(previous) && isPrimitive(detail)) {
    return { type, detail, addresses: ownerAddresses(previous, detail) }
  }
  if (previous instanceof Set || detail instanceof Set) {
    return { type, detail, addresses: [ownerAddress(detail)] }
  }
  return { type, detail, addresses: [[]] }
}

/**
 * Mirrors the folded keys onto the live composite at the top level, so the
 * seed object a caller holds reads the current model. Keys without entries
 * keep their references (Immer shares untouched subtrees), so the
 * assignments are no-ops except for the folded keys.
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

function ownerAddress(value: unknown): readonly unknown[] {
  return [canonicalAddressSegment(value)]
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
      addresses = ownerAddresses(previousOwner, nextValue)
    }
    entries.push({ type: key, detail: nextValue, addresses })
  }
  return entries
}
