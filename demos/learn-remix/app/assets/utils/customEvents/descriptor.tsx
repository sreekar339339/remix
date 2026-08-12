import {
  EVENT_SOURCE,
  createMixin,
  ref,
  type EventSource,
  type EventSourceEvent,
  type EventSourceProtocol,
} from 'remix/ui'
import {
  ALL_EVENTS,
  canonicalAddressSegment,
  createCurrentTargetEvent,
  createCustomEventsRuntimeState,
  customEventsRuntime,
  isPropertyKey,
  readPath,
  samePropertyKey,
  subscribeView,
  type CustomEventsBatchRuntimeEntry,
  type CustomEventsRuntimeState,
  type EventAddress,
} from './runtime.ts'
import type {
  CustomEventsAsHost,
  CustomEventsBatchItem,
  CustomEventsDescriptor,
  CustomEventsDispatchEvent,
  CustomEventsInit,
  CustomEventsOnFunction,
  CustomEventsOnNamespace,
  EventDetails,
  EventSourceMetadata,
} from './types.ts'

const CUSTOM_EVENTS_TRANSACTION = '$transaction'
const customEventsInitKeys = new Set(['bubbles', 'composed', 'signal'])
// Runtime twin of the type-only marker; the source proxy exposes its metadata.
const eventSourceMetadata = Symbol('eventSource')

// Evented-view namespace: `evented.<tag>` resolves to the tag string itself, so
// JSX creates a host element directly with no component runtime layer. The
// proxy is stateless and shared by every descriptor.
export const customEventsEvented = new Proxy(Object.create(null), {
  get(_, property) {
    if (typeof property !== 'string') return undefined
    return property
  },
})

type InternalEntryOptions = CustomEventsInit & {
  addresses?: readonly (readonly unknown[])[]
}

type RememberedEventContext = {
  getState(): EventDetails
  /** Folds a dispatched event into the remembered composite; absent for pure descriptors. */
  fold?(type: string, detail: unknown): readonly CustomEventsBatchRuntimeEntry[] | undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isCustomEventsInit(value: unknown): value is CustomEventsInit {
  return isRecord(value) && Object.keys(value).every((key) => customEventsInitKeys.has(key))
}

function getEventInit(init: CustomEventsInit | undefined): EventInit {
  if (init && Object.hasOwn(init, 'cancelable')) {
    throw new TypeError('customEvents describe completed facts and cannot be cancelable.')
  }
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
        customEventsRuntime.subscribe(
          runtime,
          'effect',
          {
            element,
            eventTypes: source ? new Set([source.type]) : null,
            ...(source ? { addresses: new Map([[source.type, source.path]]) } : {}),
            notify(event) {
              return listener(createCurrentTargetEvent(event, element))
            },
          },
          signal,
        )
      })}
    />
  ))(runtime, source, listener)
}

export function createCustomEventsDescriptor<
  Events extends EventDetails,
  State extends EventDetails | never = never,
>(state?: RememberedEventContext): CustomEventsDescriptor<Events, State> {
  let runtime: CustomEventsRuntimeState | undefined
  let getRuntime = () => (runtime ??= createCustomEventsRuntimeState())
  // The descriptor is itself an EventTarget: native listeners attach to it and
  // target-less writes dispatch on it.
  let base = new EventTarget()

  function resolveEntry(
    type: string,
    detail: unknown,
    options?: InternalEntryOptions,
  ): CustomEventsBatchRuntimeEntry[] {
    options?.signal?.throwIfAborted()
    if (type === ALL_EVENTS) {
      throw new TypeError('customEvents reserves "*" for subscriptions.')
    }
    if (options?.addresses === undefined && state?.fold) {
      let folded = state.fold(type, detail)
      if (folded !== undefined) return [...folded]
    }
    let addresses = options?.addresses
    return [
      {
        type,
        detail,
        ...(addresses === undefined ? {} : { addresses }),
      },
    ]
  }

  function isEntryConfiguration(value: unknown): value is Record<string, unknown> {
    return isRecord(value) && (Object.hasOwn(value, 'detail') || Object.hasOwn(value, 'options'))
  }

  function entryDetail(value: unknown) {
    if (isEntryConfiguration(value)) {
      return {
        detail: Object.hasOwn(value, 'detail') ? value.detail : null,
        options: value.options as InternalEntryOptions | undefined,
      }
    }
    return { detail: value }
  }

  function normalizeEntries(
    entries: readonly (string | Record<string, unknown>)[],
    singleKey = false,
  ) {
    let out: CustomEventsBatchRuntimeEntry[] = []
    for (let entry of entries) {
      if (typeof entry === 'string') {
        out.push(...resolveEntry(entry, null))
        continue
      }
      let objectEntries = Object.entries(entry)
      if (singleKey && objectEntries.length !== 1) {
        throw new TypeError('Each configured customEvents batch entry must contain one event.')
      }
      for (let [type, value] of objectEntries) {
        let { detail, options } = entryDetail(value)
        out.push(...resolveEntry(type, detail, options))
      }
    }
    return out
  }

  function createTransaction(entries: CustomEventsBatchRuntimeEntry[], init?: CustomEventsInit) {
    init?.signal?.throwIfAborted()
    return customEventsRuntime.createProductEvent(
      getRuntime(),
      CUSTOM_EVENTS_TRANSACTION,
      undefined,
      getEventInit(init),
      entries,
    )
  }

  // The callable descriptor: invoking it builds a fresh event.
  let create = (...args: Array<unknown>) => {
    let [typeOrEvents, detailOrInit, maybeInit] = args as [
      string | readonly CustomEventsBatchItem<Events>[] | Record<string, unknown>,
      unknown?,
      CustomEventsInit?,
    ]
    if (typeof typeOrEvents === 'string') {
      let isOptionsOnly = args.length === 2 && isCustomEventsInit(detailOrInit)
      let detail = args.length === 1 || isOptionsOnly ? null : detailOrInit
      let init = isOptionsOnly ? (detailOrInit as CustomEventsInit) : maybeInit
      return customEventsRuntime.createProductEvent(
        getRuntime(),
        typeOrEvents,
        detail,
        getEventInit(init),
        resolveEntry(typeOrEvents, detail, init),
      )
    }

    if (Array.isArray(typeOrEvents)) {
      return createTransaction(
        normalizeEntries(typeOrEvents as readonly CustomEventsBatchItem<Events>[], true),
        detailOrInit as CustomEventsInit | undefined,
      )
    }

    if (isRecord(typeOrEvents)) {
      let init = args.length >= 2 && isCustomEventsInit(detailOrInit) ? detailOrInit : undefined
      return createTransaction(normalizeEntries([typeOrEvents]), init)
    }

    throw new TypeError('customEvents expects an event name, event object, or event array.')
  }

  // The descriptor doubles as the wildcard event source: subscribing to it
  // matches every descriptor event. On a remembered descriptor the
  // composite is read for every matched event.
  let wildcardSource: EventSource = {
    [EVENT_SOURCE]: {
      type: ALL_EVENTS,
      ...(state ? { read: () => state.getState() } : {}),
      subscribe(subscriber, signal) {
        subscribeView(getRuntime(), subscriber, signal, null, undefined)
      },
    },
  }
  // Unified dispatch: a native `Event` fires on the descriptor (boolean); an
  // event-named input dispatches on the default host and resolves after views
  // and effects settle (Promise). Internal dispatches bypass the override via
  // EventTarget.prototype so product events never recurse.
  let eventsProxy: object
  let dispatchEvent = ((...args: unknown[]) => {
    let first = args[0]
    if (first instanceof Event) {
      return EventTarget.prototype.dispatchEvent.call(base, first)
    }
    let event = create(first, args[1], args[2]) as Event
    let target = customEventsRuntime.defaultHost(getRuntime())
    if (target === undefined) {
      throw new TypeError('customEvents dispatchEvent requires a registered host.')
    }
    return customEventsRuntime.dispatch(getRuntime(), target, event)
  }) as CustomEventsDispatchEvent
  let hostMixin = ref((target, signal) => {
    customEventsRuntime.registerHost(getRuntime(), target, signal)
  })
  let asHost = ((target?: EventTarget) => {
    if (target === undefined) return hostMixin
    customEventsRuntime.registerHost(getRuntime(), target)
    return eventsProxy
  }) as CustomEventsAsHost<Events, State>
  let wildcardOn = ((listener?: (event: Event) => void | Promise<unknown>) => {
    if (!listener) {
      throw new TypeError('customEvents on() requires an event listener.')
    }
    return customEventsOnMixin(getRuntime(), undefined, listener)
  }) as CustomEventsOnFunction<Events>

  // The `on` surface: a wildcard effect when called, and the source namespace
  // (every declared event name resolves to a callable source node).
  let sources = new Map<string, object>()
  let on = new Proxy(wildcardOn, {
    get(_, property) {
      if (typeof property !== 'string') return undefined
      let source = sources.get(property)
      if (!source) {
        let readRoot =
          state && Object.hasOwn(state.getState(), property)
            ? () => state.getState()[property]
            : undefined
        source = createSource(property, readRoot)
        sources.set(property, source)
      }
      return source
    },
    construct() {
      throw new TypeError('customEvents on() is not a constructor.')
    },
  }) as CustomEventsOnNamespace<Events, State>

  // The descriptor's own members and native EventTarget channel ride on the
  // callable target; the `on` namespace owns every event source.
  let descriptorTarget = Object.assign(create, { dispatchEvent, on, asHost })
  customEventsRuntime.registerHost(getRuntime(), base)

  let createSource = (
    type: string,
    readRoot: (() => unknown) | undefined,
    path: readonly unknown[] = [],
    read?: () => unknown,
  ): object => {
    let metadata: EventSourceMetadata = {
      type,
      path,
      ...(readRoot ? { read: read ?? (() => readPath(readRoot(), path)) } : {}),
    }
    let protocol: EventSourceProtocol = {
      type,
      // On a remembered descriptor every source yields detail-shaped input:
      // remembered properties read their current value, while occurrences fill
      // their slot from the matched event and read undefined otherwise.
      ...(readRoot || state
        ? {
            read: metadata.read
              ? () => metadata.read!()
              : (trigger?: EventSourceEvent) =>
                  trigger && trigger.type === type ? trigger.detail : undefined,
          }
        : {}),
      subscribe(subscriber, signal) {
        subscribeView(
          getRuntime(),
          subscriber,
          signal,
          new Set([metadata.type]),
          new Map([[metadata.type, metadata.path]]),
        )
      },
    }
    // Sources are callable: invoking one with a listener registers an
    // element-owned effect scoped to this source.
    let onNode = (listener: (event: Event) => void | Promise<unknown>) =>
      customEventsOnMixin(getRuntime(), metadata, listener)
    return new Proxy(onNode, {
      get(_, property) {
        if (property === EVENT_SOURCE) return protocol
        if (property === eventSourceMetadata) return metadata
        let at = (segment: unknown, read?: () => unknown) =>
          createSource(type, readRoot, [...path, canonicalAddressSegment(segment)], read)
        let current = metadata.read?.()
        if (property === 'get' && current instanceof Map) return (key: unknown) => at(key)
        if (property === 'has' && current instanceof Set) return (value: unknown) => at(value)
        if (property === 'as') {
          return (value: unknown) =>
            at(
              value,
              readRoot ? () => samePropertyKey(readPath(readRoot(), path), value) : undefined,
            )
        }
        return at(property)
      },
    })
  }

  let proxy = new Proxy(descriptorTarget, {
    get(target, property, receiver) {
      if (property === EVENT_SOURCE) {
        return wildcardSource[EVENT_SOURCE]
      }
      if (property === 'addEventListener' || property === 'removeEventListener') {
        return Reflect.get(EventTarget.prototype, property, base).bind(base)
      }
      if (property === 'dispatchEvent' || property === 'on' || property === 'asHost') {
        return Reflect.get(target, property, target)
      }
      return undefined
    },
    construct() {
      throw new TypeError('customEvents descriptors are not constructors.')
    },
  })
  eventsProxy = proxy
  return proxy as unknown as CustomEventsDescriptor<Events, State>
}
