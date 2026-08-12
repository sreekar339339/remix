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
  type CustomEventsOptions,
  type CustomEventsBatchItem,
  type CustomEventsDispatch,
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

type StateEventContext = {
  owner: object
  getState(): EventDetails
  /** Folds a dispatched event into the retained composite; absent for pure descriptors. */
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
>(options?: CustomEventsOptions, state?: StateEventContext): CustomEventsDescriptor<Events, State> {
  let runtime: CustomEventsRuntimeState | undefined
  let getRuntime = () => (runtime ??= createCustomEventsRuntimeState())
  let sourceOwner = state?.owner ?? {}

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
  // matches every descriptor event. On a retained descriptor or store the
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
  let dispatch = ((...args: unknown[]) => {
    let target: EventTarget | undefined
    let rest = args
    if (args.length > 0 && args[0] instanceof EventTarget) {
      target = args[0]
      rest = args.slice(1)
    }
    let createEvent = create as (...args: unknown[]) => Event
    let event = createEvent(...rest)
    if (target === undefined) {
      target = customEventsRuntime.defaultHost(getRuntime())
      if (target === undefined) {
        throw new TypeError('customEvents dispatch without a target requires a registered host.')
      }
    }
    return customEventsRuntime.dispatch(getRuntime(), target, event)
  }) as CustomEventsDispatch<Events>
  let asHost = ref((target, signal) => {
    customEventsRuntime.registerHost(getRuntime(), target, signal)
  })
  let descriptorTarget = Object.assign(Object.create(null), {
    create,
    dispatch,
    on,
    asHost,
  })
  if (options?.host) {
    customEventsRuntime.registerHost(getRuntime(), options.host)
  }

  let sources = new Map<string, object>()
  return new Proxy(descriptorTarget, {
    get(target, property, receiver) {
      if (property === EVENT_SOURCE) {
        return wildcardSource[EVENT_SOURCE]
      }
      if (Reflect.has(target, property)) {
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
  }) as unknown as CustomEventsDescriptor<Events, State>
}
