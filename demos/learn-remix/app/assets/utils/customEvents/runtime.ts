import type { EventSourceSubscriber } from 'remix/ui'

export const ALL_EVENTS = '*'

const processListener = Symbol('customEvents.processListener')

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

export type CustomEventsRuntimeEntry = {
  type: string
  detail: unknown
  addresses?: readonly EventAddress[]
}

/**
 * A dispatched product event: the carrier and its metadata are one object, so
 * the runtime never looks product events up in a side table.
 */
class ProductEvent extends CustomEvent<unknown> {
  readonly entries: CustomEventsRuntimeEntry[]
  /** Transaction carriers do not natively deliver their entry types. */
  readonly transaction: boolean
  completion?: Promise<void>

  constructor(type: string, init: EventInit, detail: unknown, entries: CustomEventsRuntimeEntry[]) {
    super(type, init)
    // CustomEvent stores null for an omitted detail; keep the dispatched
    // value observable exactly as given.
    Object.defineProperty(this, 'detail', {
      configurable: true,
      value: detail,
    })
    this.entries = entries
    this.transaction = entries.length !== 1 || entries[0]?.type !== type
  }
}

export type EventAddress = readonly unknown[]

export function canonicalAddressSegment(value: unknown) {
  return typeof value === 'symbol'
    ? value
    : typeof value === 'string' || typeof value === 'number'
      ? String(value)
      : value
}

export function isPropertyKey(value: unknown): value is PropertyKey {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'symbol'
}

export function samePropertyKey(left: unknown, right: unknown) {
  return (
    Object.is(left, right) ||
    (isPropertyKey(left) &&
      isPropertyKey(right) &&
      typeof left !== 'symbol' &&
      typeof right !== 'symbol' &&
      String(left) === String(right))
  )
}

export function readPath(value: unknown, path: readonly unknown[]) {
  for (let segment of path) {
    if (value instanceof Map) {
      if (value.has(segment)) {
        value = value.get(segment)
      } else {
        value = value.entries().find(([key]) => samePropertyKey(key, segment))?.[1]
      }
    } else if (value instanceof Set) {
      value = value.values().some((item) => samePropertyKey(item, segment))
    } else if (Array.isArray(value)) {
      value = value[Number(segment)]
    } else {
      value = value == null ? undefined : Reflect.get(Object(value), segment as PropertyKey)
    }
  }
  return value
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

function selectRoute(root: AddressNode, addresses: readonly EventAddress[] | undefined) {
  let selected = new Set<ElementSubscription>()
  if (addresses === undefined) {
    collectBranch(selected, root)
    return selected
  }
  // Whole-key subscribers always re-resolve; addressed branches fan out to
  // per-item element subscriptions only.
  for (let subscription of root.subscriptions) selected.add(subscription)
  for (let address of addresses) {
    let nodes = walkAddress(root, address)
    for (let index = 1; index < nodes.length; index++) {
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
  entry: CustomEventsRuntimeEntry,
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
  subscriptions: SubscriptionIndex
  dispatchTargets: WeakMap<EventTarget, DispatchTargetRegistration>
  hosts: WeakMap<Element, number>
  /** Host targets whose native listeners are counted for re-dispatch. */
  wrappedHosts: WeakSet<EventTarget>
  /** Native listeners attached to wrapped host targets. */
  nativeListeners: number
  defaultHost?: EventTarget
}

/** Creates only the mutable state that must remain descriptor-local. */
export function createCustomEventsRuntimeState(): CustomEventsRuntimeState {
  return {
    eventTypes: new Set(),
    eventTypeListeners: new Set(),
    subscriptions: {
      view: new Map(),
      effect: new Map(),
    },
    dispatchTargets: new WeakMap(),
    hosts: new WeakMap(),
    wrappedHosts: new WeakSet(),
    nativeListeners: 0,
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
  entries: CustomEventsRuntimeEntry[],
) {
  addEventType(runtime, carrierType)
  for (let { type } of entries) addEventType(runtime, type)
  return new ProductEvent(carrierType, init, detail, entries)
}

const RESOLVED = Promise.resolve()

function dispatch(_runtime: CustomEventsRuntimeState, target: EventTarget, event: Event) {
  // Bypass the descriptor's own dispatchEvent override to avoid recursion.
  EventTarget.prototype.dispatchEvent.call(target, event)
  return event instanceof ProductEvent ? (event.completion ?? RESOLVED) : RESOLVED
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

function wrapHostListeners(runtime: CustomEventsRuntimeState, target: EventTarget) {
  if (runtime.wrappedHosts.has(target)) return
  runtime.wrappedHosts.add(target)
  let originalAdd = target.addEventListener.bind(target)
  let originalRemove = target.removeEventListener.bind(target)
  target.addEventListener = ((type, listener, options) => {
    if (typeof options !== 'object' || options === null || !(processListener in options)) {
      runtime.nativeListeners += 1
    }
    return originalAdd(type, listener, options)
  }) as typeof target.addEventListener
  target.removeEventListener = ((type, listener, options) => {
    if (runtime.nativeListeners > 0) runtime.nativeListeners -= 1
    return originalRemove(type, listener, options)
  }) as typeof target.removeEventListener
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

  wrapHostListeners(runtime, target)
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
  carrier: CustomEvent,
  originScope: EventTarget,
  originTarget: EventTarget,
) {
  if (isElement(originTarget) && subscription.element === originTarget) {
    return true
  }
  if (!carrier.bubbles && isElement(originTarget) && subscription.element !== originTarget) {
    return false
  }

  let subscriptionScope = scopeFor(runtime, subscription.element) ?? subscription.element
  return (
    subscriptionScope === originScope ||
    (carrier.composed &&
      isElement(subscriptionScope) &&
      isElement(originScope) &&
      subscriptionScope.contains(originScope))
  )
}

const EMPTY_SUBSCRIPTIONS = new Set<ElementSubscription>()

function matchingSubscriptions(
  runtime: CustomEventsRuntimeState,
  phase: SubscriptionPhase,
  entry: CustomEventsRuntimeEntry,
) {
  let index = runtime.subscriptions[phase]
  let wildcard = index.get(ALL_EVENTS)
  let typed = index.get(entry.type)
  if (wildcard && typed) {
    let selected = selectRoute(wildcard, entry.addresses)
    for (let subscription of selectRoute(typed, entry.addresses)) {
      selected.add(subscription)
    }
    return selected
  }
  if (wildcard) return selectRoute(wildcard, entry.addresses)
  if (typed) return selectRoute(typed, entry.addresses)
  return EMPTY_SUBSCRIPTIONS
}

function notifyEntries(
  runtime: CustomEventsRuntimeState,
  entries: CustomEventsRuntimeEntry[],
  originScope: EventTarget,
  originTarget: EventTarget,
  carrier: CustomEvent,
) {
  let snapshots: Array<CustomEvent | undefined> = []
  let snapshotFor = (index: number) => {
    let event = snapshots[index]
    if (!event) {
      event = createEventSnapshot(entries[index]!, originTarget, carrier)
      snapshots[index] = event
    }
    return event
  }

  let matches = new Map<ElementSubscription, number>()
  if (runtime.subscriptions.view.size > 0) {
    for (let index = 0; index < entries.length; index++) {
      let entry = entries[index]!
      for (let subscription of matchingSubscriptions(runtime, 'view', entry)) {
        if (matchesScope(runtime, subscription, carrier, originScope, originTarget)) {
          matches.set(subscription, index)
        }
      }
    }
  }

  let source: Array<[ElementSubscription, number]> = []
  let remaining: Array<[ElementSubscription, number]> = []
  for (let match of matches) {
    ;(match[0].element === originTarget ? source : remaining).push(match)
  }
  let commit = (selected: typeof source) => {
    let results: unknown[] = []
    for (let [subscription, index] of selected) {
      results.push(subscription.notify(snapshotFor(index)))
    }
    return Promise.all(results)
  }
  let viewsCommitted = source.length
    ? commit(source).then(() => commit(remaining))
    : commit(remaining)

  let viewsAndEffectsSettled = viewsCommitted.then(() => {
    if (runtime.subscriptions.effect.size === 0) return
    let effectResults: unknown[] = []
    for (let index = 0; index < entries.length; index++) {
      let entry = entries[index]!
      for (let subscription of matchingSubscriptions(runtime, 'effect', entry)) {
        if (matchesScope(runtime, subscription, carrier, originScope, originTarget)) {
          collect(effectResults, () => subscription.notify(snapshotFor(index)))
        }
      }
    }
    return Promise.all(effectResults)
  })

  return viewsAndEffectsSettled.then(() => {})
}

function process(runtime: CustomEventsRuntimeState, event: Event) {
  if (!(event instanceof ProductEvent)) return
  let originTarget = event.target
  if (!originTarget) return
  let originHost = isElement(originTarget) ? findHost(runtime, originTarget) : undefined
  if (originHost && event.composed !== true) {
    event.stopPropagation()
  }
  if (event.transaction && originTarget === runtime.defaultHost && runtime.nativeListeners > 0) {
    for (let entry of event.entries) {
      EventTarget.prototype.dispatchEvent.call(
        originTarget,
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
    event.completion = notifyEntries(runtime, event.entries, originScope, originTarget, event)
  } catch (error) {
    event.completion = Promise.reject(error)
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
    let listenerOptions = {
      signal: controller.signal,
      [processListener]: true,
    } as AddEventListenerOptions & Record<typeof processListener, boolean>
    target.addEventListener(type, (event) => process(runtime, event), listenerOptions)
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
  /** The descriptor's registered default host, if any. */
  defaultHost(runtime: CustomEventsRuntimeState) {
    return runtime.defaultHost
  },
}

/** Registers an evented-view subscription, shared by wildcard and sub-sources. */
export function subscribeView(
  runtime: CustomEventsRuntimeState,
  subscriber: EventSourceSubscriber,
  signal: AbortSignal,
  eventTypes: ReadonlySet<string> | null,
  addresses: ReadonlyMap<string, EventAddress> | undefined,
) {
  customEventsRuntime.subscribe(
    runtime,
    'view',
    {
      element: subscriber.element,
      eventTypes,
      ...(addresses === undefined ? {} : { addresses }),
      notify(event) {
        return subscriber.notify(event)
      },
    },
    signal,
  )
}
