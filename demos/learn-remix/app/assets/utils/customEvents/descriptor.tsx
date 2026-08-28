import { createMixin, ref } from 'remix/ui'
import {
  ALL_EVENTS,
  canonicalPathSegment,
  createRuntimeState,
  customEventsRuntime,
  readPath,
  samePropertyKey,
  subscribeSelector,
  type BatchEvent,
  type CustomEventsRuntimeEntry,
  type RuntimeState,
} from './runtime.ts'
import { CUSTOM_EVENTS_SOURCE, type EventedSource } from './evented.tsx'
import type {
  CustomEventsAsHost,
  CustomEventsDescriptor,
  CustomEventsDispatchEvent,
  CustomEventInit,
  CustomEventsOnNamespace,
  EventDetails,
  EventSourceMetadata,
} from './types.ts'

const CUSTOM_BATCH = '$batch'
const DEFAULT_CUSTOM_EVENTS_INIT: EventInit = {
  bubbles: true,
  cancelable: false,
}
const customEventInitKeys = new Set(['bubbles', 'composed', 'signal'])

export type BatchContext = {
  getState(): EventDetails
  /** Applies a dispatched event to the detail composite. The owner signal
   * marks applications triggered by the run that holds it, so their
   * reaction refires cascade within that run instead of aborting it. */
  apply(
    type: string,
    detail: unknown,
    owner?: AbortSignal,
  ):
    | CustomEventsRuntimeEntry[]
    | { entries: CustomEventsRuntimeEntry[]; settle: Promise<void> }
    | undefined
  /** Dispatches applied entries as a batch; used by async batch sessions. */
  dispatchEntries?(entries: CustomEventsRuntimeEntry[]): Promise<unknown>
  /** True while a batch session holds uncommitted detail mutations. */
  pendingBatch(): boolean
  /** Defers a dispatch until the active batch session commits and flushes. */
  deferDispatch(run: () => Promise<void> | void): Promise<void>
  /** Listener names: fields that occupy the composite as callables, never data reads. */
  notificationKeys(): ReadonlySet<string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isCustomEventInit(value: unknown): value is CustomEventInit {
  if (!isRecord(value)) return false
  for (let key in value) {
    if (Object.hasOwn(value, key) && !customEventInitKeys.has(key)) return false
  }
  return true
}

function getEventInit(init: CustomEventInit | undefined): EventInit {
  if (init && Object.hasOwn(init, 'cancelable')) {
    throw new TypeError('customEvents describe completed facts and cannot be cancelable.')
  }
  if (init === undefined) return DEFAULT_CUSTOM_EVENTS_INIT
  return {
    bubbles: init?.bubbles ?? true,
    cancelable: false,
    ...(init?.composed === undefined ? {} : { composed: init.composed }),
  }
}

function customEventsOnMixin(
  runtime: RuntimeState,
  selector: { type: string; path: readonly unknown[] } | undefined,
  listener: (event: Event, signal: AbortSignal) => void | Promise<unknown>,
) {
  return createMixin<
    Element,
    [
      runtime: RuntimeState,
      selector: { type: string; path: readonly unknown[] } | undefined,
      listener: (event: Event, signal: AbortSignal) => void | Promise<unknown>,
    ]
  >((handle) => (runtime, selector, listener) => (
    <handle.element
      mix={ref((element, signal) => {
        // Reentry semantics: each delivery aborts the previous signal for
        // this element+selector pair, so stale async work cancels itself.
        let reentered: AbortController | undefined
        subscribeSelector(
          runtime,
          'effect',
          {
            element,
            notify: (event: CustomEvent) => {
              reentered?.abort()
              reentered = new AbortController()
              return listener(event, reentered.signal)
            },
          },
          signal,
          selector,
        )
      })}
    />
  ))(runtime, selector, listener)
}

export function createCustomEventsDescriptor<
  Events extends EventDetails,
  State extends EventDetails,
>(state: BatchContext): CustomEventsDescriptor<Events, State> {
  let runtime: RuntimeState | undefined
  let getRuntime = () => (runtime ??= createRuntimeState())
  // The descriptor carries a native EventTarget channel: native listeners
  // attach to it and target-less writes dispatch on it.
  let base = new EventTarget()
  state.dispatchEntries = (entries) => {
    let target = customEventsRuntime.defaultHost(getRuntime())
    if (target === undefined) {
      throw new TypeError('customEvents dispatchEntries requires a registered host.')
    }
    return customEventsRuntime.dispatch(getRuntime(), target, createBatch(entries))
  }

  function resolveEntry(
    type: string,
    detail: unknown,
    options?: CustomEventInit,
    settles?: Array<Promise<void>>,
  ): CustomEventsRuntimeEntry[] {
    options?.signal?.throwIfAborted()
    if (type === ALL_EVENTS) {
      throw new TypeError('customEvents "*" is the wildcard and cannot be dispatched.')
    }
    let applied = state.apply(type, detail, options?.signal)
    if (applied !== undefined) {
      if (Array.isArray(applied)) return applied
      settles?.push(applied.settle)
      return applied.entries
    }
    return [{ type, detail }]
  }

  function createBatch(
    entries: CustomEventsRuntimeEntry[],
    init?: CustomEventInit,
    settles?: Array<Promise<void>>,
  ) {
    init?.signal?.throwIfAborted()
    let event = customEventsRuntime.createBatchEvent(
      getRuntime(),
      CUSTOM_BATCH,
      undefined,
      getEventInit(init),
      entries,
    )
    if (settles !== undefined) event.settles = settles
    return event
  }

  // A single resolved entry builds the event under its own name (like the
  // string form); several entries commit as one batch carrier.
  let buildBatch = (
    entries: CustomEventsRuntimeEntry[],
    init?: CustomEventInit,
    settles?: Array<Promise<void>>,
  ) => {
    if (entries.length === 1) {
      let entry = entries[0]!
      let event = customEventsRuntime.createBatchEvent(
        getRuntime(),
        entry.type,
        entry.detail,
        getEventInit(init),
        entries,
      )
      if (settles !== undefined) event.settles = settles
      return event
    }
    return createBatch(entries, init, settles)
  }

  // The builder member: a bare name builds a detail-less event, an object of
  // event-named details builds a single-event or batch carrier, and a
  // function of the composite builds the input at dispatch time.
  let create = (...args: Array<unknown>) => {
    let [typeOrEvents, detailOrInit] = args as [string | Record<string, unknown>, unknown?]
    if (typeof typeOrEvents === 'string') {
      let init = args.length >= 2 ? (detailOrInit as CustomEventInit) : undefined
      if (args.length >= 2 && !isCustomEventInit(detailOrInit)) {
        throw new TypeError('customEvents create() expects CustomEventInit as the second argument.')
      }
      let settles: Array<Promise<void>> = []
      let event = customEventsRuntime.createBatchEvent(
        getRuntime(),
        typeOrEvents,
        null,
        getEventInit(init),
        resolveEntry(typeOrEvents, null, init, settles),
      )
      if (settles.length > 0) event.settles = settles
      return event
    }

    if (isRecord(typeOrEvents)) {
      let init = args.length >= 2 ? (detailOrInit as CustomEventInit | undefined) : undefined
      // A single-key object dispatches its one event without allocating a
      // keys array or Object.entries pairs.
      let singleType: string | undefined
      let multi = false
      for (let key in typeOrEvents) {
        if (!Object.hasOwn(typeOrEvents, key)) continue
        if (singleType !== undefined) {
          multi = true
          break
        }
        singleType = key
      }
      if (singleType !== undefined && !multi) {
        let settles: Array<Promise<void>> = []
        return buildBatch(
          resolveEntry(singleType, typeOrEvents[singleType]!, init, settles),
          init,
          settles,
        )
      }
      let entries: CustomEventsRuntimeEntry[] = []
      let settles: Array<Promise<void>> = []
      for (let key in typeOrEvents) {
        if (Object.hasOwn(typeOrEvents, key)) {
          entries.push(...resolveEntry(key, typeOrEvents[key]!, init, settles))
        }
      }
      return buildBatch(entries, init, settles)
    }

    throw new TypeError('customEvents create expects an event name or an object of details.')
  }

  // The descriptor doubles as the wildcard event source: subscribing to it
  // matches every descriptor event and reads the whole composite.
  let wildcardSource: EventedSource = {
    [CUSTOM_EVENTS_SOURCE]: {
      type: ALL_EVENTS,
      path: [],
      read: () => state.getState(),
      subscribe(subscriber, signal) {
        subscribeSelector(getRuntime(), 'view', subscriber, signal, undefined)
      },
    },
  }
  // Unified dispatch: a native `Event` fires on the descriptor (boolean); an
  // event-named input dispatches on the default host and resolves after views
  // and effects settle (Promise). Internal dispatches bypass the override via
  // EventTarget.prototype so batch events never recurse.
  let eventsProxy: object
  let performDispatch = (...args: unknown[]) => {
    let first = args[0]
    if (first instanceof Event) {
      return EventTarget.prototype.dispatchEvent.call(base, first)
    }
    let event = (args.length > 1 ? create(first, args[1]) : create(first)) as BatchEvent
    let target = customEventsRuntime.defaultHost(getRuntime())
    if (target === undefined) {
      throw new TypeError('customEvents dispatchEvent requires a registered host.')
    }
    let completion = customEventsRuntime.dispatch(getRuntime(), target, event)
    let settles = event.settles
    if (settles !== undefined && settles.length > 0) {
      completion = Promise.all([completion, ...settles]).then(() => {})
    }
    return completion
  }
  let dispatchEvent = ((...args: unknown[]) => {
    if (state.pendingBatch()) {
      // A batch session is mid-mutation: dispatching now would read and
      // write against the uncommitted draft window, so the dispatch runs
      // after the session's next flush instead.
      return state.deferDispatch(() => performDispatch(...args) as Promise<void>)
    }
    return performDispatch(...args)
  }) as CustomEventsDispatchEvent
  let hostMixin = ref((target, signal) => {
    customEventsRuntime.registerHost(getRuntime(), target, signal)
  })
  let asHost = ((target?: EventTarget) => {
    if (target === undefined) return hostMixin
    customEventsRuntime.registerHost(getRuntime(), target)
    return eventsProxy
  }) as CustomEventsAsHost<Events, State>
  // The `on` surface is a pure namespace: `'*'` runs an element-owned effect
  // for every descriptor event, every other name is a selector (callable
  // to scope an effect to one selector).
  let wildcardOn = (listener: (event: Event) => void | Promise<unknown>) => {
    if (!listener) {
      throw new TypeError('customEvents on() requires an event listener.')
    }
    return customEventsOnMixin(getRuntime(), undefined, listener)
  }
  // The wildcard is also a view source: the same protocol the descriptor
  // carries, so `on={events.on['*']}` mounts a whole-composite view.
  Object.defineProperty(wildcardOn, CUSTOM_EVENTS_SOURCE, {
    value: {
      type: ALL_EVENTS,
      path: [],
      read: () => state.getState(),
      subscribe(
        subscriber: { element: Element | undefined; notify(event: CustomEvent<unknown>): unknown },
        signal: AbortSignal,
      ) {
        subscribeSelector(getRuntime(), 'view', subscriber, signal, undefined)
      },
    },
  })
  let selectors = new Map<string, object>()
  let on = new Proxy(Object.create(null), {
    get(_, property) {
      if (property === '*') return wildcardOn
      if (typeof property !== 'string') return undefined
      let selector = selectors.get(property)
      if (!selector) {
        // Selectors decide at read time whether their name is a data field
        // or an occurrence, so creation never depends on field
        // initialization (constructor-time effect registrations precede the
        // fields).
        selector = createSelector(property)
        selectors.set(property, selector)
      }
      return selector
    },
  }) as CustomEventsOnNamespace<Events, State>

  // The descriptor's own members and native EventTarget channel ride on the
  // plain target; the `on` namespace owns every event source.
  let descriptorTarget = Object.assign({}, { create, dispatchEvent, on, asHost })
  customEventsRuntime.registerHost(getRuntime(), base)

  let createSelector = (
    type: string,
    path: readonly unknown[] = [],
    read?: () => unknown,
  ): object => {
    let metadata: EventSourceMetadata & EventedSource[typeof CUSTOM_EVENTS_SOURCE] = {
      type,
      path,
      // Every source yields detail-shaped input: data properties read their
      // current value, while occurrences fill their slot from the matched
      // event and read undefined otherwise. The field-existence decision is
      // made at read time so creation never depends on field initialization.
      read: read ?? ((trigger?: CustomEvent<unknown>) => {
        let current = state.getState()
        if (Object.hasOwn(current, type) && !state.notificationKeys().has(type)) {
          return readPath(current[type], path)
        }
        return trigger && trigger.type === type ? trigger.detail : undefined
      }),
      subscribe(subscriber, signal) {
        subscribeSelector(getRuntime(), 'view', subscriber, signal, { type, path })
      },
    }
    // Selectors are callable: invoking one with a listener registers an
    // element-owned effect scoped to this selector.
    let nested = new Map<unknown, object>()
    let at = (segment: unknown, read?: () => unknown) => {
      let canonical = canonicalPathSegment(segment)
      if (read === undefined) {
        let selector = nested.get(canonical)
        if (!selector) {
          selector = createSelector(type, [...path, canonical])
          nested.set(canonical, selector)
        }
        return selector
      }
      return createSelector(type, [...path, canonical], read)
    }
    let onNode = (listener: (event: Event) => void | Promise<unknown>) =>
      customEventsOnMixin(getRuntime(), metadata, listener)
    return new Proxy(onNode, {
      get(_, property) {
        if (property === CUSTOM_EVENTS_SOURCE) return metadata
        // The get/has/as accessors are data-independent so deep chains can
        // be navigated before their values exist (reaction registration).
        if (property === 'get') return (key: unknown) => at(key)
        if (property === 'has') return (value: unknown) => at(value)
        if (property === 'as') {
          return (value: unknown) =>
            at(value, () => samePropertyKey(readPath(state.getState()[type], path), value))
        }
        return at(property)
      },
    })
  }

  let proxy = new Proxy(descriptorTarget, {
    get(target, property, receiver) {
      if (property === 'details') {
        return state.getState()
      }
      if (property === CUSTOM_EVENTS_SOURCE) {
        return wildcardSource[CUSTOM_EVENTS_SOURCE]
      }
      if (property === 'addEventListener' || property === 'removeEventListener') {
        // Resolve the base's own methods so native listeners on the default
        // host are counted for batch re-dispatch.
        return Reflect.get(base, property, base).bind(base)
      }
      if (
        property === 'create' ||
        property === 'dispatchEvent' ||
        property === 'on' ||
        property === 'asHost'
      ) {
        return Reflect.get(target, property, target)
      }
      return undefined
    },
  })
  eventsProxy = proxy
  return proxy as unknown as CustomEventsDescriptor<Events, State>
}
