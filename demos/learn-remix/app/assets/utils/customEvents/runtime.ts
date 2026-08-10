import { EVENT_ROUTES } from 'remix/ui'

export const ALL_EVENTS = '*'

export type SubscriptionPhase = 'view' | 'effect'

type DispatchTargetRegistration = {
  count: number
  cleanup(): void
}

type ElementSubscription = {
  element: Element | undefined
  eventTypes: ReadonlySet<string> | null
  addresses?: ReadonlyMap<string, EventAddress>
  notify(event: CustomEvent): unknown
}

type AddressNode = {
  subscriptions: Set<ElementSubscription>
  children: Map<unknown, AddressNode>
}

type SubscriptionIndex = Record<SubscriptionPhase, Map<string, AddressNode>>

/**
 * Patch operation classification per event entry address. `mapReplace` marks a
 * keyed patch on a Map container: whole-key subscribers skip such events
 * because per-item elements already follow their own keyed routes.
 */
export type CustomEventsEntryOp = 'add' | 'remove' | 'replace' | 'mapReplace'

export type CustomEventsBatchRuntimeEntry = {
  type: string
  detail: unknown
  addresses?: readonly EventAddress[]
  ops?: readonly CustomEventsEntryOp[]
}

type ProductEventMetadata = {
  entries: CustomEventsBatchRuntimeEntry[]
  completion?: Promise<void>
  /** Batch-shaped carriers do not natively deliver their entry types. */
  transaction?: boolean
}

type TransactionEvent = {
  event: CustomEvent
  addresses?: readonly EventAddress[]
  ops?: readonly CustomEventsEntryOp[]
}

export type EventAddress = readonly unknown[]

export function canonicalAddressSegment(value: unknown) {
  return typeof value === 'symbol'
    ? value
    : typeof value === 'string' || typeof value === 'number'
      ? String(value)
      : value
}

function isElement(value: unknown): value is Element {
  return typeof Element !== 'undefined' && value instanceof Element
}

function setEventProperty(event: Event, property: PropertyKey, value: unknown) {
  Object.defineProperty(event, property, {
    configurable: true,
    value,
  })
}

function createAddressNode(): AddressNode {
  return { subscriptions: new Set(), children: new Map() }
}

function walkAddress(root: AddressNode, address: EventAddress, create = false) {
  let nodes = [root]
  let node = root
  for (let segment of address) {
    let child = node.children.get(segment)
    if (!child && create) {
      child = createAddressNode()
      node.children.set(segment, child)
    }
    if (!child) break
    node = child
    nodes.push(node)
  }
  return nodes
}

function addToRoute(root: AddressNode, subscription: ElementSubscription, address: EventAddress) {
  walkAddress(root, address, true).at(-1)!.subscriptions.add(subscription)
}

function removeFromRoute(
  root: AddressNode,
  subscription: ElementSubscription,
  address: EventAddress,
) {
  let nodes = walkAddress(root, address)
  if (nodes.length !== address.length + 1) return
  nodes.at(-1)!.subscriptions.delete(subscription)
  for (let index = address.length; index > 0; index--) {
    let child = nodes[index]
    if (child.subscriptions.size || child.children.size) break
    nodes[index - 1].children.delete(address[index - 1])
  }
}

function collectBranch(selected: Set<ElementSubscription>, node: AddressNode) {
  for (let subscription of node.subscriptions) selected.add(subscription)
  for (let child of node.children.values()) collectBranch(selected, child)
}

function selectRoute(
  root: AddressNode,
  addresses: readonly EventAddress[] | undefined,
  ops?: readonly CustomEventsEntryOp[],
  warnRootSkip?: () => void,
) {
  let selected = new Set<ElementSubscription>()
  if (addresses === undefined) {
    collectBranch(selected, root)
    return selected
  }
  // Whole-key changes (the root key itself was patched) notify every
  // subscriber; keyed changes notify their addressed branch only. Map item
  // replaces skip the root so whole-key subscribers do not re-resolve while
  // per-item elements follow their own keyed routes.
  let includeRoot =
    addresses.some((address) => address.length === 0) ||
    ops === undefined ||
    ops.some((op) => op !== 'mapReplace')
  if (!includeRoot && root.subscriptions.size > 0) warnRootSkip?.()
  for (let address of addresses) {
    let nodes = walkAddress(root, address)
    for (let index = includeRoot ? 0 : 1; index < nodes.length; index++) {
      for (let subscription of nodes[index].subscriptions) {
        selected.add(subscription)
      }
    }
    if (nodes.length === address.length + 1) {
      collectBranch(selected, nodes.at(-1)!)
    }
  }
  return selected
}

function ownCleanup(cleanup: () => void, signal?: AbortSignal) {
  let active = true
  let dispose = () => {
    if (!active) return
    active = false
    signal?.removeEventListener('abort', dispose)
    cleanup()
  }
  if (signal?.aborted) dispose()
  else signal?.addEventListener('abort', dispose, { once: true })
  return dispose
}

function collect(results: unknown[], operation: () => unknown) {
  try {
    results.push(operation())
  } catch (error) {
    results.push(Promise.reject(error))
  }
}

function createEventSnapshot(
  entry: CustomEventsBatchRuntimeEntry,
  target: EventTarget,
  carrier: CustomEvent,
) {
  let event = new CustomEvent(entry.type, {
    bubbles: carrier.bubbles,
    cancelable: false,
    composed: carrier.composed,
    detail: entry.detail,
  })
  setEventProperty(event, 'target', target)
  return event
}

export function createCurrentTargetEvent(event: CustomEvent, currentTarget: EventTarget) {
  let callbackEvent = new CustomEvent(event.type, {
    bubbles: false,
    cancelable: event.cancelable,
    composed: event.composed,
    detail: event.detail,
  })
  setEventProperty(callbackEvent, 'target', event.target)
  setEventProperty(callbackEvent, 'currentTarget', currentTarget)
  return callbackEvent
}

/** Descriptor-local data consumed by the shared runtime kernel. */
export type CustomEventsRuntimeState = {
  eventTypes: Set<string>
  eventTypeListeners: Set<(type: string) => void>
  eventMetadata: WeakMap<Event, ProductEventMetadata>
  subscriptions: SubscriptionIndex
  dispatchTargets: WeakMap<EventTarget, DispatchTargetRegistration>
  hosts: WeakMap<Element, number>
  rootSkipWarnings: Set<string>
  defaultHost?: EventTarget
}

/** Creates only the mutable state that must remain descriptor-local. */
export function createCustomEventsRuntimeState(): CustomEventsRuntimeState {
  return {
    eventTypes: new Set(),
    eventTypeListeners: new Set(),
    eventMetadata: new WeakMap(),
    subscriptions: {
      view: new Map(),
      effect: new Map(),
    },
    dispatchTargets: new WeakMap(),
    hosts: new WeakMap(),
    rootSkipWarnings: new Set(),
  }
}

function addEventType(runtime: CustomEventsRuntimeState, type: string) {
  if (runtime.eventTypes.has(type)) return
  runtime.eventTypes.add(type)
  for (let listener of runtime.eventTypeListeners) listener(type)
}

function createProductEvent(
  runtime: CustomEventsRuntimeState,
  carrierType: string,
  detail: unknown,
  init: EventInit,
  entries: CustomEventsBatchRuntimeEntry[],
) {
  addEventType(runtime, carrierType)
  for (let { type } of entries) addEventType(runtime, type)
  let event = new CustomEvent(carrierType, { ...init, detail })
  if (detail === undefined) setEventProperty(event, 'detail', undefined)
  runtime.eventMetadata.set(event, {
    entries,
    transaction: entries.length !== 1 || entries[0]?.type !== carrierType,
  })
  return event
}

function dispatch(runtime: CustomEventsRuntimeState, target: EventTarget, event: Event) {
  let metadata = runtime.eventMetadata.get(event)
  target.dispatchEvent(event)
  return metadata?.completion ?? Promise.resolve()
}

function subscribe(
  runtime: CustomEventsRuntimeState,
  phaseName: SubscriptionPhase,
  subscription: ElementSubscription,
  signal?: AbortSignal,
) {
  let phase = runtime.subscriptions[phaseName]
  let selectors = subscription.eventTypes ?? [ALL_EVENTS]
  let routes: Array<[string, AddressNode, EventAddress]> = []

  for (let selector of selectors) {
    if (selector !== ALL_EVENTS) addEventType(runtime, selector)
    let route = phase.get(selector)
    if (!route) {
      route = createAddressNode()
      phase.set(selector, route)
    }
    let address = subscription.addresses?.get(selector) ?? []
    addToRoute(route, subscription, address)
    routes.push([selector, route, address])
  }

  let unregisterTarget = subscription.element
    ? registerDispatchTarget(runtime, subscription.element)
    : undefined
  return ownCleanup(() => {
    unregisterTarget?.()
    for (let [selector, route, address] of routes) {
      removeFromRoute(route, subscription, address)
      if (!route.subscriptions.size && !route.children.size) {
        phase.delete(selector)
      }
    }
  }, signal)
}

function registerHost(
  runtime: CustomEventsRuntimeState,
  target: EventTarget,
  signal?: AbortSignal,
) {
  let unregisterTarget = registerDispatchTarget(runtime, target)

  if (isElement(target)) {
    runtime.hosts.set(target, (runtime.hosts.get(target) ?? 0) + 1)
    return ownCleanup(() => {
      unregisterTarget()
      let count = runtime.hosts.get(target) ?? 0
      if (count <= 1) runtime.hosts.delete(target)
      else runtime.hosts.set(target, count - 1)
    }, signal)
  }

  runtime.defaultHost = target
  return ownCleanup(() => {
    unregisterTarget()
    if (runtime.defaultHost === target) runtime.defaultHost = undefined
  }, signal)
}

function findHost(runtime: CustomEventsRuntimeState, element: Element | undefined) {
  for (let current = element; current; current = current.parentElement ?? undefined) {
    if (runtime.hosts.has(current)) return current
  }
}

function scopeFor(runtime: CustomEventsRuntimeState, element: Element | undefined) {
  return findHost(runtime, element) ?? runtime.defaultHost
}

function matchesScope(
  runtime: CustomEventsRuntimeState,
  subscription: ElementSubscription,
  event: CustomEvent,
  originScope: EventTarget,
  originTarget: EventTarget,
) {
  if (isElement(originTarget) && subscription.element === originTarget) {
    return true
  }
  if (!event.bubbles && isElement(originTarget) && subscription.element !== originTarget) {
    return false
  }

  let subscriptionScope = scopeFor(runtime, subscription.element) ?? subscription.element
  return (
    subscriptionScope === originScope ||
    (event.composed &&
      isElement(subscriptionScope) &&
      isElement(originScope) &&
      subscriptionScope.contains(originScope))
  )
}

function warnRootSkipOnce(runtime: CustomEventsRuntimeState, type: string) {
  if (runtime.rootSkipWarnings.has(type)) return
  runtime.rootSkipWarnings.add(type)
  console.warn(
    `Map value replaces in "${type}" skip whole-key subscribers, so a whole-key <list> or ` +
      `<output> does not re-render for in-place item changes. Subscribe per item (for example ` +
      `store.events.${type}.get(id)) when an element renders fields that change per item.`,
  )
}

function* matchingSubscriptions(
  runtime: CustomEventsRuntimeState,
  phase: SubscriptionPhase,
  transactionEvent: TransactionEvent,
) {
  let index = runtime.subscriptions[phase]
  let warnRootSkip = () => warnRootSkipOnce(runtime, transactionEvent.event.type)
  let wildcard = index.get(ALL_EVENTS)
  if (wildcard) {
    yield* selectRoute(wildcard, transactionEvent.addresses, transactionEvent.ops, warnRootSkip)
  }
  let typed = index.get(transactionEvent.event.type)
  if (typed) {
    yield* selectRoute(typed, transactionEvent.addresses, transactionEvent.ops, warnRootSkip)
  }
}

function notifyEntries(
  runtime: CustomEventsRuntimeState,
  entries: CustomEventsBatchRuntimeEntry[],
  originScope: EventTarget,
  originTarget: EventTarget,
  carrier: CustomEvent,
) {
  let events: TransactionEvent[] = entries.map((entry) => {
    let event = createEventSnapshot(entry, originTarget, carrier)
    let addresses = entry.addresses
    let ops = entry.ops
    if (addresses !== undefined && ops !== undefined) {
      setEventProperty(event, EVENT_ROUTES, {
        addresses,
        ops: ops.map((op) => (op === 'mapReplace' ? 'replace' : op)),
      })
    }
    return {
      event,
      ...(addresses === undefined ? {} : { addresses }),
      ...(ops === undefined ? {} : { ops }),
    }
  })

  let matches = new Map<ElementSubscription, TransactionEvent>()
  for (let transactionEvent of events) {
    for (let subscription of matchingSubscriptions(runtime, 'view', transactionEvent)) {
      if (matchesScope(runtime, subscription, transactionEvent.event, originScope, originTarget)) {
        matches.set(subscription, transactionEvent)
      }
    }
  }

  let source: Array<[ElementSubscription, TransactionEvent]> = []
  let remaining: Array<[ElementSubscription, TransactionEvent]> = []
  for (let match of matches) {
    ;(match[0].element === originTarget ? source : remaining).push(match)
  }
  let commit = (selected: typeof source) =>
    Promise.all(selected.values().map(([subscription, match]) => subscription.notify(match.event)))
  let viewsCommitted = source.length
    ? commit(source).then(() => commit(remaining))
    : commit(remaining)

  let viewsAndEffectsSettled = viewsCommitted.then(() => {
    let effectResults: unknown[] = []
    for (let transactionEvent of events) {
      for (let subscription of matchingSubscriptions(runtime, 'effect', transactionEvent)) {
        if (
          matchesScope(runtime, subscription, transactionEvent.event, originScope, originTarget)
        ) {
          collect(effectResults, () => subscription.notify(transactionEvent.event))
        }
      }
    }
    return Promise.all(effectResults)
  })

  return viewsAndEffectsSettled.then(() => {})
}

function process(runtime: CustomEventsRuntimeState, event: Event) {
  if (!(event instanceof CustomEvent)) return
  let metadata = runtime.eventMetadata.get(event)
  if (!metadata) return
  runtime.eventMetadata.delete(event)

  let originTarget = event.target
  if (!originTarget) return
  let originHost = isElement(originTarget) ? findHost(runtime, originTarget) : undefined
  if (originHost && event.composed !== true) {
    event.stopPropagation()
  }
  if (metadata.transaction && originTarget === runtime.defaultHost) {
    for (let entry of metadata.entries) {
      originTarget.dispatchEvent(
        new CustomEvent(entry.type, {
          bubbles: event.bubbles,
          cancelable: false,
          composed: event.composed,
          detail: entry.detail,
        }),
      )
    }
  }

  let originScope =
    originHost ?? (isElement(originTarget) ? originTarget : (runtime.defaultHost ?? originTarget))
  try {
    metadata.completion = notifyEntries(runtime, metadata.entries, originScope, originTarget, event)
  } catch (error) {
    metadata.completion = Promise.reject(error)
  }
}

function registerDispatchTarget(runtime: CustomEventsRuntimeState, target: EventTarget) {
  let existing = runtime.dispatchTargets.get(target)
  if (existing) {
    existing.count += 1
    return ownCleanup(() => releaseDispatchTarget(runtime, target, existing))
  }

  let controller = new AbortController()
  let listenedTypes = new Set<string>()
  let listen = (type: string) => {
    if (listenedTypes.has(type)) return
    listenedTypes.add(type)
    target.addEventListener(type, (event) => process(runtime, event), { signal: controller.signal })
  }
  runtime.eventTypeListeners.add(listen)
  for (let type of runtime.eventTypes) listen(type)

  let registration: DispatchTargetRegistration = {
    count: 1,
    cleanup: () => {
      runtime.eventTypeListeners.delete(listen)
      controller.abort()
    },
  }
  runtime.dispatchTargets.set(target, registration)
  return ownCleanup(() => releaseDispatchTarget(runtime, target, registration))
}

function releaseDispatchTarget(
  runtime: CustomEventsRuntimeState,
  target: EventTarget,
  registration: DispatchTargetRegistration,
) {
  registration.count -= 1
  if (registration.count > 0) return
  registration.cleanup()
  runtime.dispatchTargets.delete(target)
}

/** Shared operations over descriptor-local runtime state. */
export const customEventsRuntime = {
  createProductEvent,
  dispatch,
  subscribe,
  registerHost,
}
