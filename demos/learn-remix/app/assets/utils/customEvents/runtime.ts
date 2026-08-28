export const ALL_EVENTS = '*'
const ALL_SELECTORS = [ALL_EVENTS]

export type SubscriptionPhase = 'view' | 'effect'

type DispatchTargetRegistration = {
  count: number
  cleanup(): void
}

type ElementSubscription = {
  element: Element | undefined
  eventTypes: ReadonlySet<string> | null
  paths?: ReadonlyMap<string, Path>
  notify(event: CustomEvent): unknown
}

type PathNode = {
  subscriptions: Set<ElementSubscription>
  children: Map<unknown, PathNode>
}

type SubscriptionIndex = Record<SubscriptionPhase, Map<string, PathNode>>

export type CustomEventsRuntimeEntry = {
  type: string
  detail: unknown
  paths?: readonly Path[]
}

/**
 * A dispatched batch event: the carrier and its metadata are one object, so
 * the runtime never looks batch events up in a side table.
 */
export class BatchEvent extends CustomEvent<unknown> {
  readonly entries: CustomEventsRuntimeEntry[]
  /** Batch carriers do not natively deliver their entry types. */
  readonly batch: boolean
  completion?: Promise<void>
  /** Batch-session completions the dispatch promise must await (async
   * effect continuations opened while this batch was built). */
  settles?: Array<Promise<void>>

  constructor(type: string, init: EventInit, detail: unknown, entries: CustomEventsRuntimeEntry[]) {
    super(type, init)
    // CustomEvent stores null for an omitted detail; keep the dispatched
    // value observable exactly as given.
    Object.defineProperty(this, 'detail', {
      configurable: true,
      value: detail,
    })
    this.entries = entries
    this.batch = entries.length !== 1 || entries[0]?.type !== type
  }
}

export type Path = readonly unknown[]

/**
 * The single addressing key of a route segment: strings and numbers
 * canonicalise to their string form (they address the same Map key and the
 * same route), while symbols and objects keep their identity. Selectors,
 * written paths, and subscribers all produce exactly this canonical form, so
 * the route trie is keyed by one consistent representation; value reads
 * tolerate the same string/number equivalence via `samePropertyKey`.
 */
export function canonicalPathSegment(value: unknown) {
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
      } else if (typeof segment === 'string' && value.has(Number(segment))) {
        // Numbers canonicalise to strings, so a canonical segment's numeric
        // twin is its direct key and reads stay O(1).
        value = value.get(Number(segment))
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

function createPathNode(): PathNode {
  return { subscriptions: new Set(), children: new Map() }
}

function walkPath(root: PathNode, path: Path, create = false) {
  let nodes = [root]
  let node = root
  for (let segment of path) {
    let child = node.children.get(segment)
    if (!child && create) {
      child = createPathNode()
      node.children.set(segment, child)
    }
    if (!child) break
    node = child
    nodes.push(node)
  }
  return nodes
}

function addToRoute(root: PathNode, subscription: ElementSubscription, path: Path) {
  walkPath(root, path, true).at(-1)!.subscriptions.add(subscription)
}

function removeFromRoute(root: PathNode, subscription: ElementSubscription, path: Path) {
  let nodes = walkPath(root, path)
  if (nodes.length !== path.length + 1) return
  nodes.at(-1)!.subscriptions.delete(subscription)
  for (let index = path.length; index > 0; index--) {
    let child = nodes[index]
    if (child.subscriptions.size || child.children.size) break
    nodes[index - 1].children.delete(path[index - 1])
  }
}

function collectBranch(selected: Set<ElementSubscription>, node: PathNode) {
  for (let subscription of node.subscriptions) selected.add(subscription)
  for (let child of node.children.values()) collectBranch(selected, child)
}

function selectRoute(
  root: PathNode,
  paths: readonly Path[] | undefined,
  selected: Set<ElementSubscription>,
) {
  if (paths === undefined) {
    collectBranch(selected, root)
    return selected
  }
  // Whole-key subscribers always re-resolve; addressed branches fan out to
  // per-item element subscriptions only.
  for (let subscription of root.subscriptions) selected.add(subscription)
  for (let path of paths) {
    let node = root
    let depth = 0
    for (let segment of path) {
      let child = node.children.get(segment)
      if (!child) break
      node = child
      depth++
      for (let subscription of node.subscriptions) {
        selected.add(subscription)
      }
    }
    if (depth === path.length) {
      collectBranch(selected, node)
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

/** Attribute marking an element as a descriptor host scope. */
const HOST_ATTRIBUTE = 'data-rmx-custom-host'

/** Descriptor-local data consumed by the shared runtime kernel. */
export type RuntimeState = {
  eventTypes: Set<string>
  eventTypeListeners: Set<(type: string) => void>
  subscriptions: SubscriptionIndex
  dispatchTargets: WeakMap<EventTarget, DispatchTargetRegistration>
  defaultHost?: EventTarget
}

/** Creates only the mutable state that must remain descriptor-local. */
export function createRuntimeState(): RuntimeState {
  return {
    eventTypes: new Set(),
    eventTypeListeners: new Set(),
    subscriptions: {
      view: new Map(),
      effect: new Map(),
    },
    dispatchTargets: new WeakMap(),
  }
}

function addEventType(runtime: RuntimeState, type: string) {
  if (runtime.eventTypes.has(type)) return
  runtime.eventTypes.add(type)
  for (let listener of runtime.eventTypeListeners) listener(type)
}

function createBatchEvent(
  runtime: RuntimeState,
  carrierType: string,
  detail: unknown,
  init: EventInit,
  entries: CustomEventsRuntimeEntry[],
) {
  addEventType(runtime, carrierType)
  for (let { type } of entries) addEventType(runtime, type)
  return new BatchEvent(carrierType, init, detail, entries)
}

const RESOLVED = Promise.resolve()

function dispatch(_runtime: RuntimeState, target: EventTarget, event: Event) {
  // Bypass the descriptor's own dispatchEvent override to avoid recursion.
  EventTarget.prototype.dispatchEvent.call(target, event)
  return event instanceof BatchEvent ? (event.completion ?? RESOLVED) : RESOLVED
}

function subscribe(
  runtime: RuntimeState,
  phaseName: SubscriptionPhase,
  subscription: ElementSubscription,
  signal?: AbortSignal,
) {
  let phase = runtime.subscriptions[phaseName]
  let selectors = subscription.eventTypes ?? ALL_SELECTORS
  let routes: Array<[string, PathNode, Path]> = []

  for (let selector of selectors) {
    if (selector !== ALL_EVENTS) addEventType(runtime, selector)
    let route = phase.get(selector)
    if (!route) {
      route = createPathNode()
      phase.set(selector, route)
    }
    let path = subscription.paths?.get(selector) ?? []
    addToRoute(route, subscription, path)
    routes.push([selector, route, path])
  }

  let unregisterTarget = subscription.element
    ? registerDispatchTarget(runtime, subscription.element)
    : undefined
  return ownCleanup(() => {
    unregisterTarget?.()
    for (let [selector, route, path] of routes) {
      removeFromRoute(route, subscription, path)
      if (!route.subscriptions.size && !route.children.size) {
        phase.delete(selector)
      }
    }
  }, signal)
}

function registerHost(runtime: RuntimeState, target: EventTarget, signal?: AbortSignal) {
  let unregisterTarget = registerDispatchTarget(runtime, target)

  if (isElement(target)) {
    // Host scope marking lives in the DOM: `closest()` resolves scopes, so
    // no descriptor-side parentElement walk or WeakMap is needed. The
    // dataset value refcounts nested registrations.
    let count = Number(target.getAttribute(HOST_ATTRIBUTE) ?? 0) + 1
    target.setAttribute(HOST_ATTRIBUTE, String(count))
    return ownCleanup(() => {
      unregisterTarget()
      let remaining = Number(target.getAttribute(HOST_ATTRIBUTE) ?? 0) - 1
      if (remaining <= 0) target.removeAttribute(HOST_ATTRIBUTE)
      else target.setAttribute(HOST_ATTRIBUTE, String(remaining))
    }, signal)
  }

  runtime.defaultHost = target
  return ownCleanup(() => {
    unregisterTarget()
    if (runtime.defaultHost === target) runtime.defaultHost = undefined
  }, signal)
}

const HOST_DATASET_KEY = 'rmxCustomHost'

function findHost(element: Element | undefined) {
  return element?.closest(`[${HOST_ATTRIBUTE}]`) ?? undefined
}

function scopeFor(runtime: RuntimeState, element: Element | undefined) {
  return findHost(element) ?? runtime.defaultHost
}

function matchesScope(
  runtime: RuntimeState,
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
  // A dispatch on the descriptor or a bridged domain target (a non-element
  // origin target) broadcasts across every host scope of the descriptor —
  // reaction derivations ride such carriers, so element hosts must hear
  // them too.
  if (!isElement(originTarget)) {
    return true
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

function matchingSubscriptions(
  runtime: RuntimeState,
  phase: SubscriptionPhase,
  entry: CustomEventsRuntimeEntry,
  selected: Set<ElementSubscription>,
) {
  let index = runtime.subscriptions[phase]
  let wildcard = index.get(ALL_EVENTS)
  let typed = index.get(entry.type)
  if (wildcard) selectRoute(wildcard, entry.paths, selected)
  if (typed) selectRoute(typed, entry.paths, selected)
  return selected
}

function notifyEntries(
  runtime: RuntimeState,
  entries: CustomEventsRuntimeEntry[],
  originScope: EventTarget,
  originTarget: EventTarget,
  carrier: CustomEvent,
  prebuilt?: CustomEvent[],
) {
  let snapshots: Array<CustomEvent | undefined> = prebuilt ?? []
  let snapshotFor = (index: number) => {
    let event = snapshots[index]
    if (!event) {
      event = createEventSnapshot(entries[index]!, originTarget, carrier)
      snapshots[index] = event
    }
    return event
  }

  let source: Array<[ElementSubscription, number]> = []
  let remaining: Array<[ElementSubscription, number]> = []
  let scratch = new Set<ElementSubscription>()
  if (runtime.subscriptions.view.size > 0) {
    // Iterate entries backwards so the first match a subscription sees is its
    // last forward match: each subscription commits once, with the last
    // matched entry, without a match map or a second pass.
    let visited = new Set<ElementSubscription>()
    for (let index = entries.length - 1; index >= 0; index--) {
      let entry = entries[index]!
      scratch.clear()
      matchingSubscriptions(runtime, 'view', entry, scratch)
      for (let subscription of scratch) {
        if (visited.has(subscription)) continue
        if (!matchesScope(runtime, subscription, carrier, originScope, originTarget)) continue
        visited.add(subscription)
        ;(subscription.element === originTarget ? source : remaining).push([subscription, index])
      }
    }
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
      scratch.clear()
      matchingSubscriptions(runtime, 'effect', entry, scratch)
      for (let subscription of scratch) {
        if (matchesScope(runtime, subscription, carrier, originScope, originTarget)) {
          collect(effectResults, () => subscription.notify(snapshotFor(index)))
        }
      }
    }
    return Promise.all(effectResults)
  })

  return viewsAndEffectsSettled.then(() => {})
}

function process(runtime: RuntimeState, event: Event) {
  if (!(event instanceof BatchEvent)) return
  let originTarget = event.target
  if (!originTarget) return
  let originHost = isElement(originTarget) ? findHost(originTarget) : undefined
  if (originHost && event.composed !== true) {
    event.stopPropagation()
  }
  // Native listeners on a bridged domain target receive one event per
  // entry; those events double as the subscription snapshots, so each entry
  // builds a single event serving both consumers. Element origins need no
  // mirroring — the carrier itself rides real DOM bubbling.
  let entryEvents: CustomEvent[] | undefined
  if (event.batch && !isElement(originTarget)) {
    entryEvents = event.entries.map((entry) => createEventSnapshot(entry, originTarget, event))
    for (let entryEvent of entryEvents) {
      EventTarget.prototype.dispatchEvent.call(originTarget, entryEvent)
    }
  }

  let originScope =
    originHost ?? (isElement(originTarget) ? originTarget : (runtime.defaultHost ?? originTarget))
  try {
    event.completion = notifyEntries(
      runtime,
      event.entries,
      originScope,
      originTarget,
      event,
      entryEvents,
    )
  } catch (error) {
    event.completion = Promise.reject(error)
  }
}

function registerDispatchTarget(runtime: RuntimeState, target: EventTarget) {
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
    target.addEventListener(type, (event) => process(runtime, event), {
      signal: controller.signal,
    })
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
  runtime: RuntimeState,
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
  createBatchEvent,
  dispatch,
  subscribe,
  registerHost,
  /** The descriptor's registered default host, if any. */
  defaultHost(runtime: RuntimeState) {
    return runtime.defaultHost
  },
}

/**
 * Registers a subscription from one selector (or the wildcard when absent),
 * shared by evented views and element-owned effects. The selector's type and
 * path become the subscription's event types and path routes.
 */
export function subscribeSelector(
  runtime: RuntimeState,
  phase: SubscriptionPhase,
  subscriber: {
    element: Element | undefined
    notify(event: CustomEvent<unknown>): unknown
  },
  signal: AbortSignal,
  selector: { type: string; path: readonly unknown[] } | undefined,
) {
  customEventsRuntime.subscribe(
    runtime,
    phase,
    {
      element: subscriber.element,
      eventTypes: selector ? new Set([selector.type]) : null,
      ...(selector ? { paths: new Map([[selector.type, selector.path]]) } : {}),
      notify(event) {
        // Every element-owned subscription receives the matched event with
        // its element as the currentTarget, like a native listener.
        return subscriber.notify(
          subscriber.element ? createCurrentTargetEvent(event, subscriber.element) : event,
        )
      },
    },
    signal,
  )
}
