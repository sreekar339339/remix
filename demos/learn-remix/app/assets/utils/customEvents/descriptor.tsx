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
  createCurrentTargetEvent,
  createCustomEventsRuntimeState,
  customEventsRuntime,
  isPropertyKey,
  readPath,
  samePropertyKey,
  subscribeView,
  type CustomEventsRuntimeEntry,
  type CustomEventsRuntimeState,
  type EventAddress,
} from './runtime.ts'
import { reservedCustomEventsNames } from './types.ts'
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
const reservedNames = new Set<string>(reservedCustomEventsNames)
const customEventInitKeys = new Set(['bubbles', 'composed', 'signal'])
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

type InternalEntryOptions = CustomEventInit

type RememberedEventContext = {
  getState(): EventDetails
  /** Folds a dispatched event into the remembered composite; absent for pure descriptors. */
  fold?(type: string, detail: unknown): CustomEventsRuntimeEntry[] | undefined
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
  // The descriptor carries a native EventTarget channel: native listeners
  // attach to it and target-less writes dispatch on it.
  let base = new EventTarget()

  function resolveEntry(
    type: string,
    detail: unknown,
    options?: InternalEntryOptions,
  ): CustomEventsRuntimeEntry[] {
    options?.signal?.throwIfAborted()
    if (type === ALL_EVENTS) {
      throw new TypeError('customEvents reserves "*" for subscriptions.')
    }
    // A function detail is a derived-detail callback: it is invoked with the
    // live composite and its return value becomes the detail.
    if (typeof detail === 'function') {
      if (!state) {
        throw new TypeError('customEvents derived details require a remembered descriptor.')
      }
      detail = (detail as (root: EventDetails) => unknown)(state.getState())
    }
    // Descriptor API names cannot be events; `root` is the composite event
    // and exists only on remembered descriptors.
    if (type !== 'root' && reservedNames.has(type)) {
      throw new TypeError(`customEvents reserves "${type}" for its API.`)
    }
    if (type === 'root' && !state?.fold) {
      throw new TypeError('customEvents reserves "root" for remembered composites.')
    }
    if (state?.fold) {
      let folded = state.fold(type, detail)
      if (folded !== undefined) return folded
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

  // The builder member: a bare name builds a detail-less event, an object of
  // event-named details builds a single-event or transaction carrier.
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
      // A single resolved entry builds the event under its own name (like the
      // string form); several entries commit as one transaction carrier.
      let product = (entries: CustomEventsRuntimeEntry[]) => {
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
      let keys = Object.keys(typeOrEvents)
      if (keys.length === 1) {
        // A single-key object dispatches its one event without allocating an
        // entries array or Object.entries pairs.
        let type = keys[0]!
        return product(resolveEntry(type, typeOrEvents[type], init))
      }
      let entries: CustomEventsRuntimeEntry[] = []
      for (let key of keys) {
        entries.push(...resolveEntry(key, typeOrEvents[key]!, init))
      }
      return product(entries)
    }

    throw new TypeError('customEvents create expects an event name or an object of details.')
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
    let event = (args.length > 1 ? create(first, args[1]) : create(first)) as Event
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
  // The `on` surface is a pure namespace: `'*'` runs an element-owned effect
  // for every descriptor event, every other name is a source (callable
  // to scope an effect to one source).
  let wildcardOn = (listener: (event: Event) => void | Promise<unknown>) => {
    if (!listener) {
      throw new TypeError('customEvents on() requires an event listener.')
    }
    return customEventsOnMixin(getRuntime(), undefined, listener)
  }
  // The named root event of a remembered descriptor: the composite source
  // under the `events.root` handle, with the wildcard effect as its callable.
  // Pure descriptors have no root — the descriptor itself is their wildcard.
  let rootSource = state
    ? new Proxy(wildcardOn, {
        get(_, property) {
          if (property === EVENT_SOURCE) {
            return {
              type: 'root',
              read: () => state.getState(),
              subscribe(subscriber: EventSourceSubscriber, signal: AbortSignal) {
                subscribeView(getRuntime(), subscriber, signal, null, undefined)
              },
            } satisfies EventSourceProtocol
          }
          if (property === eventSourceMetadata) {
            return { type: 'root', path: [] }
          }
          return undefined
        },
      })
    : undefined
  let sources = new Map<string, object>()
  let on = new Proxy(Object.create(null), {
    get(_, property) {
      if (property === '*') return wildcardOn
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
  }) as CustomEventsOnNamespace<Events, State>

  // The descriptor's own members and native EventTarget channel ride on the
  // plain target; the `on` namespace owns every event source.
  let descriptorTarget = Object.assign({}, { create, dispatchEvent, on, asHost })
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
    let nested = new Map<unknown, object>()
    let at = (segment: unknown, read?: () => unknown) => {
      let canonical = canonicalAddressSegment(segment)
      if (read === undefined) {
        let source = nested.get(canonical)
        if (!source) {
          source = createSource(type, readRoot, [...path, canonical])
          nested.set(canonical, source)
        }
        return source
      }
      return createSource(type, readRoot, [...path, canonical], read)
    }
    let onNode = (listener: (event: Event) => void | Promise<unknown>) =>
      customEventsOnMixin(getRuntime(), metadata, listener)
    return new Proxy(onNode, {
      get(_, property) {
        if (property === EVENT_SOURCE) return protocol
        if (property === eventSourceMetadata) return metadata
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
        // Resolve the base's own methods so native listeners on the default
        // host are counted for transaction re-dispatch.
        return Reflect.get(base, property, base).bind(base)
      }
      if (property === 'root') {
        return rootSource
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
