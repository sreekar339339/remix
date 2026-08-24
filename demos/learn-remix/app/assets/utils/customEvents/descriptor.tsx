import {
  EVENT_SOURCE,
  createMixin,
  ref,
  type EventSource,
  type EventSourceEvent,
  type EventSourceProtocol,
  type EventSourceSubscriber,
} from 'remix/ui'
import {
  ALL_EVENTS,
  canonicalAddressSegment,
  createCustomEventsRuntimeState,
  customEventsRuntime,
  readPath,
  samePropertyKey,
  subscribeSource,
  type CustomEventsRuntimeEntry,
  type CustomEventsRuntimeState,
} from './runtime.ts'
import type {
  CustomEventsAsHost,
  CustomEventsDescriptor,
  CustomEventsDispatchEvent,
  CustomEventInit,
  CustomEventsOnNamespace,
  EventDetails,
  EventSourceMetadata,
} from './types.ts'

const CUSTOM_EVENTS_TRANSACTION = '$transaction'
const DEFAULT_CUSTOM_EVENTS_INIT: EventInit = {
  bubbles: true,
  cancelable: false,
}
const customEventInitKeys = new Set(['bubbles', 'composed', 'signal'])

// Evented-view namespace: `evented.<tag>` resolves to the tag string itself, so
// JSX creates a host element directly with no component runtime layer. The
// proxy is stateless and shared by every descriptor.
export const customEventsEvented = new Proxy(Object.create(null), {
  get(_, property) {
    if (typeof property !== 'string') return undefined
    return property
  },
})

export type RememberedEventContext = {
  getState(): EventDetails
  /** Folds a dispatched event into the remembered composite. */
  fold(
    type: string,
    detail: unknown,
  ):
    | CustomEventsRuntimeEntry[]
    | { entries: CustomEventsRuntimeEntry[]; settle: Promise<void> }
    | undefined
  /** Dispatches folded entries as a transaction; used by async fold sessions. */
  dispatchEntries?(entries: CustomEventsRuntimeEntry[]): Promise<unknown>
  /** True while a fold session holds uncommitted draft mutations. */
  pendingSession(): boolean
  /** Defers a dispatch until the active fold session commits and flushes. */
  deferDispatch(run: () => Promise<void> | void): Promise<void>
  /** Fold names: fields that occupy the composite as callables, never data reads. */
  occurrenceKeys(): ReadonlySet<string>
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
  runtime: CustomEventsRuntimeState,
  source: { type: string; path: readonly unknown[] } | undefined,
  listener: (event: Event) => void | Promise<unknown>,
) {
  return createMixin<
    Element,
    [
      runtime: CustomEventsRuntimeState,
      source: { type: string; path: readonly unknown[] } | undefined,
      listener: (event: Event) => void | Promise<unknown>,
    ]
  >((handle) => (runtime, source, listener) => (
    <handle.element
      mix={ref((element, signal) => {
        subscribeSource(
          runtime,
          'effect',
          {
            element,
            notify: (event: CustomEvent) => listener(event),
          },
          signal,
          source,
        )
      })}
    />
  ))(runtime, source, listener)
}

export function createCustomEventsDescriptor<
  Events extends EventDetails,
  State extends EventDetails,
>(state: RememberedEventContext): CustomEventsDescriptor<Events, State> {
  let runtime: CustomEventsRuntimeState | undefined
  let getRuntime = () => (runtime ??= createCustomEventsRuntimeState())
  // The descriptor carries a native EventTarget channel: native listeners
  // attach to it and target-less writes dispatch on it.
  let base = new EventTarget()
  // Completions that must settle before the dispatch resolves: async fold
  // sessions register their handler and flush completion here.
  let settlers: Array<Promise<void>> = []
  state.dispatchEntries = (entries) => {
    let target = customEventsRuntime.defaultHost(getRuntime())
    if (target === undefined) {
      throw new TypeError('customEvents dispatchEntries requires a registered host.')
    }
    return customEventsRuntime.dispatch(getRuntime(), target, createTransaction(entries))
  }

  function resolveEntry(
    type: string,
    detail: unknown,
    options?: CustomEventInit,
  ): CustomEventsRuntimeEntry[] {
    options?.signal?.throwIfAborted()
    if (type === ALL_EVENTS) {
      throw new TypeError('customEvents "*" is the wildcard and cannot be dispatched.')
    }
    let folded = state.fold(type, detail)
    if (folded !== undefined) {
      if (Array.isArray(folded)) return folded
      settlers.push(folded.settle)
      return folded.entries
    }
    return [{ type, detail }]
  }

  function createTransaction(entries: CustomEventsRuntimeEntry[], init?: CustomEventInit) {
    init?.signal?.throwIfAborted()
    return customEventsRuntime.createProductEvent(
      getRuntime(),
      CUSTOM_EVENTS_TRANSACTION,
      undefined,
      getEventInit(init),
      entries,
    )
  }

  // A single resolved entry builds the event under its own name (like the
  // string form); several entries commit as one transaction carrier.
  let buildProduct = (entries: CustomEventsRuntimeEntry[], init?: CustomEventInit) => {
    if (entries.length === 1) {
      let entry = entries[0]!
      return customEventsRuntime.createProductEvent(
        getRuntime(),
        entry.type,
        entry.detail,
        getEventInit(init),
        entries,
      )
    }
    return createTransaction(entries, init)
  }

  // The builder member: a bare name builds a detail-less event, an object of
  // event-named details builds a single-event or transaction carrier, and a
  // function of the composite builds the input at dispatch time.
  let create = (...args: Array<unknown>) => {
    let [typeOrEvents, detailOrInit] = args as [string | Record<string, unknown>, unknown?]
    if (typeof typeOrEvents === 'string') {
      let init = args.length >= 2 ? (detailOrInit as CustomEventInit) : undefined
      if (args.length >= 2 && !isCustomEventInit(detailOrInit)) {
        throw new TypeError('customEvents create() expects CustomEventInit as the second argument.')
      }
      return customEventsRuntime.createProductEvent(
        getRuntime(),
        typeOrEvents,
        null,
        getEventInit(init),
        resolveEntry(typeOrEvents, null, init),
      )
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
        return buildProduct(resolveEntry(singleType, typeOrEvents[singleType], init), init)
      }
      let entries: CustomEventsRuntimeEntry[] = []
      for (let key in typeOrEvents) {
        if (Object.hasOwn(typeOrEvents, key)) {
          entries.push(...resolveEntry(key, typeOrEvents[key]!, init))
        }
      }
      return buildProduct(entries, init)
    }

    throw new TypeError('customEvents create expects an event name or an object of details.')
  }

  // The descriptor doubles as the wildcard event source: subscribing to it
  // matches every descriptor event and reads the whole composite.
  let wildcardSource: EventSource = {
    [EVENT_SOURCE]: {
      type: ALL_EVENTS,
      read: () => state.getState(),
      subscribe(subscriber, signal) {
        subscribeSource(getRuntime(), 'view', subscriber, signal, undefined)
      },
    },
  }
  // Unified dispatch: a native `Event` fires on the descriptor (boolean); an
  // event-named input dispatches on the default host and resolves after views
  // and effects settle (Promise). Internal dispatches bypass the override via
  // EventTarget.prototype so product events never recurse.
  let eventsProxy: object
  let performDispatch = (...args: unknown[]) => {
    let first = args[0]
    if (first instanceof Event) {
      return EventTarget.prototype.dispatchEvent.call(base, first)
    }
    let event = (args.length > 1 ? create(first, args[1]) : create(first)) as Event
    let target = customEventsRuntime.defaultHost(getRuntime())
    if (target === undefined) {
      throw new TypeError('customEvents dispatchEvent requires a registered host.')
    }
    let completion = customEventsRuntime.dispatch(getRuntime(), target, event)
    if (settlers.length > 0) {
      let pending = settlers.splice(0)
      completion = Promise.all([completion, ...pending]).then(() => {})
    }
    return completion
  }
  let dispatchEvent = ((...args: unknown[]) => {
    if (state.pendingSession()) {
      // A fold session is mid-mutation: dispatching now would read and write
      // against the uncommitted draft window, so the dispatch runs after the
      // session's next flush instead.
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
  // for every descriptor event, every other name is a source (callable
  // to scope an effect to one source).
  let wildcardOn = (listener: (event: Event) => void | Promise<unknown>) => {
    if (!listener) {
      throw new TypeError('customEvents on() requires an event listener.')
    }
    return customEventsOnMixin(getRuntime(), undefined, listener)
  }
  // The wildcard is also a view source: the same protocol the descriptor
  // carries, so `on={events.on['*']}` mounts a whole-composite view.
  Object.defineProperty(wildcardOn, EVENT_SOURCE, {
    value: {
      type: ALL_EVENTS,
      read: () => state.getState(),
      subscribe(
        subscriber: import('remix/ui').EventSourceSubscriber,
        signal: AbortSignal,
      ) {
        subscribeSource(getRuntime(), 'view', subscriber, signal, undefined)
      },
    },
  })
  let sources = new Map<string, object>()
  let on = new Proxy(Object.create(null), {
    get(_, property) {
      if (property === '*') return wildcardOn
      if (typeof property !== 'string') return undefined
      let source = sources.get(property)
      if (!source) {
        // Sources decide at read time whether their name is a data field or
        // an occurrence, so creation never depends on field initialization
        // (constructor-time reaction registrations precede the fields).
        source = createSource(property)
        sources.set(property, source)
      }
      return source
    },
  }) as CustomEventsOnNamespace<Events, State>

  // The descriptor's own members and native EventTarget channel ride on the
  // plain target; the `on` namespace owns every event source.
  let descriptorTarget = Object.assign({}, { create, dispatchEvent, on, asHost })
  customEventsRuntime.registerHost(getRuntime(), base)

  let createSource = (
    type: string,
    path: readonly unknown[] = [],
    read?: () => unknown,
  ): object => {
    let metadata: EventSourceMetadata & EventSourceProtocol = {
      type,
      path,
      // Every source yields detail-shaped input: data properties read their
      // current value, while occurrences fill their slot from the matched
      // event and read undefined otherwise. The field-existence decision is
      // made at read time so creation never depends on field initialization.
      read: read ?? ((trigger?: EventSourceEvent) => {
        let current = state.getState()
        if (Object.hasOwn(current, type) && !state.occurrenceKeys().has(type)) {
          return readPath(current[type], path)
        }
        return trigger && trigger.type === type ? trigger.detail : undefined
      }),
      subscribe(subscriber, signal) {
        subscribeSource(getRuntime(), 'view', subscriber, signal, { type, path })
      },
    }
    // Sources are callable: invoking one with a listener registers an
    // element-owned effect scoped to this source.
    let nested = new Map<unknown, object>()
    let at = (segment: unknown, read?: () => unknown) => {
      let canonical = canonicalAddressSegment(segment)
      if (read === undefined) {
        let source = nested.get(canonical)
        if (!source) {
          source = createSource(type, [...path, canonical])
          nested.set(canonical, source)
        }
        return source
      }
      return createSource(type, [...path, canonical], read)
    }
    let onNode = (listener: (event: Event) => void | Promise<unknown>) =>
      customEventsOnMixin(getRuntime(), metadata, listener)
    return new Proxy(onNode, {
      get(_, property) {
        if (property === EVENT_SOURCE) return metadata
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
      if (property === 'detail') {
        return state.getState()
      }
      if (property === EVENT_SOURCE) {
        return wildcardSource[EVENT_SOURCE]
      }
      if (property === 'addEventListener' || property === 'removeEventListener') {
        // Resolve the base's own methods so native listeners on the default
        // host are counted for transaction re-dispatch.
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