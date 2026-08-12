import { EVENT_SOURCE, ref, type EventSource } from 'remix/ui'
import {
  ALL_EVENTS,
  createCustomEventsRuntimeState,
  customEventsRuntime,
  type CustomEventsBatchRuntimeEntry,
  type CustomEventsRuntimeState,
  type CustomEventsEntryOp,
} from './runtime.ts'
import { customEventsOnMixin } from './remix.tsx'
import { createEventSource } from './eventSources.ts'
import {
  type CustomEventsAsHost,
  type CustomEventsBatchItem,
  type CustomEventsDispatchEvent,
  type CustomEventsFactory,
  type CustomEventsDescriptor,
  type CustomEventsInit,
  type CustomEventsOnFunction,
  type EventDetails,
} from './types.ts'

const CUSTOM_EVENTS_TRANSACTION = '$transaction'
const customEventsInitKeys = new Set(['bubbles', 'composed', 'signal'])

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
  ops?: readonly CustomEventsEntryOp[]
}

type RememberedEventContext = {
  owner: object
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

export function createCustomEventsDescriptor<
  Events extends EventDetails,
  State extends EventDetails | never = never,
>(state?: RememberedEventContext): CustomEventsDescriptor<Events, State> {
  let runtime: CustomEventsRuntimeState | undefined
  let getRuntime = () => (runtime ??= createCustomEventsRuntimeState())
  let sourceOwner = state?.owner ?? {}
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
    let ops = options?.ops
    return [
      {
        type,
        detail,
        ...(addresses === undefined ? {} : { addresses }),
        ...(ops === undefined ? {} : { ops }),
      },
    ]
  }

  function isEntryConfiguration(value: unknown): value is Record<string, unknown> {
    return isRecord(value) && (Object.hasOwn(value, 'detail') || Object.hasOwn(value, 'options'))
  }

  function normalizeConfiguredBatch(configuredEvents: readonly CustomEventsBatchItem<Events>[]) {
    return configuredEvents.flatMap((configuredEvent) => {
      if (typeof configuredEvent === 'string') {
        return resolveEntry(configuredEvent, null)
      }

      let eventEntries = Object.entries(configuredEvent)
      if (eventEntries.length !== 1) {
        throw new TypeError('Each configured customEvents batch entry must contain one event.')
      }

      let [type, rawValue] = eventEntries[0] as [string, unknown]
      if (isEntryConfiguration(rawValue)) {
        return resolveEntry(
          type,
          Object.hasOwn(rawValue, 'detail') ? rawValue.detail : null,
          rawValue.options as InternalEntryOptions | undefined,
        )
      }
      return resolveEntry(type, rawValue)
    })
  }

  function normalizeEventObject(events: Record<string, unknown>) {
    let entries: CustomEventsBatchRuntimeEntry[] = []
    for (let [type, value] of Object.entries(events)) {
      if (isEntryConfiguration(value)) {
        entries.push(
          ...resolveEntry(
            type,
            Object.hasOwn(value, 'detail') ? value.detail : null,
            value.options as InternalEntryOptions | undefined,
          ),
        )
      } else {
        entries.push(...resolveEntry(type, value))
      }
    }
    return entries
  }

  let on = ((...args: unknown[]) => {
    let listener = args[0] as ((event: Event) => void | Promise<unknown>) | undefined
    if (!listener) {
      throw new TypeError('customEvents on() requires an event listener.')
    }
    return customEventsOnMixin(getRuntime(), undefined, listener)
  }) as CustomEventsOnFunction<Events>

  let create = ((...args: Array<unknown>) => {
    let [typeOrEvents, detailOrInit, maybeInit] = args as [
      string | readonly CustomEventsBatchItem<Events>[] | Record<string, unknown>,
      unknown?,
      CustomEventsInit?,
    ]
    if (typeof typeOrEvents === 'string') {
      let isOptionsOnly = args.length === 2 && isCustomEventsInit(detailOrInit)
      let detail = args.length === 1 || isOptionsOnly ? null : detailOrInit
      let init = isOptionsOnly ? (detailOrInit as CustomEventsInit) : maybeInit
      let entries = resolveEntry(typeOrEvents, detail, init)
      return customEventsRuntime.createProductEvent(
        getRuntime(),
        typeOrEvents,
        detail,
        getEventInit(init),
        entries,
      )
    }

    if (Array.isArray(typeOrEvents)) {
      let entries = normalizeConfiguredBatch(
        typeOrEvents as readonly CustomEventsBatchItem<Events>[],
      )
      let init = detailOrInit as CustomEventsInit | undefined
      init?.signal?.throwIfAborted()
      return customEventsRuntime.createProductEvent(
        getRuntime(),
        CUSTOM_EVENTS_TRANSACTION,
        undefined,
        getEventInit(init),
        entries,
      )
    }

    if (isRecord(typeOrEvents)) {
      let init = args.length >= 2 && isCustomEventsInit(detailOrInit) ? detailOrInit : undefined
      init?.signal?.throwIfAborted()
      let entries = normalizeEventObject(typeOrEvents)
      return customEventsRuntime.createProductEvent(
        getRuntime(),
        CUSTOM_EVENTS_TRANSACTION,
        undefined,
        getEventInit(init),
        entries,
      )
    }

    throw new TypeError('customEvents expects an event name, event object, or event array.')
  }) as CustomEventsFactory<Events>

  // The descriptor doubles as the wildcard event source: subscribing to it
  // matches every descriptor event. On a remembered descriptor the
  // composite snapshot is read for every matched event.
  let wildcardSource: EventSource = {
    [EVENT_SOURCE]: {
      type: ALL_EVENTS,
      ...(state ? { read: () => state.getState() } : {}),
      subscribe(subscriber, signal) {
        customEventsRuntime.subscribe(
          getRuntime(),
          'view',
          {
            element: subscriber.element,
            eventTypes: null,
            notify(event) {
              return subscriber.notify(event)
            },
          },
          signal,
        )
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
    let createEvent = create as (...args: unknown[]) => Event
    let event = createEvent(first, args[1], args[2])
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
  let descriptorTarget = Object.assign(base, {
    create,
    dispatchEvent,
    on,
    asHost,
  })
  customEventsRuntime.registerHost(getRuntime(), base)

  let sources = new Map<string, object>()
  // The proxy resolves the wildcard protocol, the descriptor's own members,
  // and the native EventTarget channel methods; every other name (including
  // Object.prototype members) creates an event source.
  let proxy = new Proxy(descriptorTarget, {
    get(target, property, receiver) {
      if (property === EVENT_SOURCE) {
        return wildcardSource[EVENT_SOURCE]
      }
      if (
        property === 'addEventListener' ||
        property === 'removeEventListener' ||
        property === 'dispatchEvent'
      ) {
        return Reflect.get(target, property, target).bind(target)
      }
      if (Object.hasOwn(target, property)) {
        return Reflect.get(target, property, receiver)
      }
      if (typeof property !== 'string') return undefined
      let source = sources.get(property)
      if (!source) {
        let readRoot =
          state && Object.hasOwn(state.getState(), property)
            ? () => state.getState()[property]
            : undefined
        source = createEventSource(
          sourceOwner,
          property,
          readRoot,
          (metadata, listener) => customEventsOnMixin(getRuntime(), metadata, listener),
          (metadata, subscriber, signal) =>
            customEventsRuntime.subscribe(
              getRuntime(),
              'view',
              {
                element: subscriber.element,
                eventTypes: new Set([metadata.type]),
                addresses: new Map([[metadata.type, metadata.path]]),
                notify(event) {
                  return subscriber.notify(event)
                },
              },
              signal,
            ),
          state !== undefined,
        )
        sources.set(property, source)
      }
      return source
    },
  })
  eventsProxy = proxy
  return proxy as unknown as CustomEventsDescriptor<Events, State>
}
