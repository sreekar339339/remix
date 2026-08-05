import {
  createElement,
  createMixin,
  EVENT_SOURCE,
  ref,
  type EventSource,
  type EventSourceEvent,
  type EventSourceSubscriber,
  type Handle,
  type RemixNode,
} from 'remix/ui'
import {
  ALL_EVENTS,
  createCurrentTargetEvent,
  customEventsRuntime,
  type CustomEventsRuntimeState,
} from './runtime.ts'
import { type CustomEventsEventedView, type EventDetails } from './types.ts'
import { getEventSourceMetadata, type EventSourceMetadata } from './eventSources.ts'

export const customEventsOnMixin = createMixin<
  Element,
  [
    runtime: CustomEventsRuntimeState,
    source: EventSourceMetadata | undefined,
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
))

// Wildcard source standing in for an omitted `on` prop: subscribes to every
// descriptor event, reading the whole state snapshot for held events and the
// occurrence payload otherwise.
function createWildcardEventSource(
  runtime: CustomEventsRuntimeState,
  getState: (() => EventDetails) | undefined,
): EventSource {
  return {
    [EVENT_SOURCE]: {
      type: ALL_EVENTS,
      ...(getState
        ? {
            read: (trigger?: EventSourceEvent) =>
              trigger && !Object.hasOwn(getState(), trigger.type) ? trigger.detail : getState(),
          }
        : {}),
      subscribe(subscriber: EventSourceSubscriber, signal: AbortSignal) {
        customEventsRuntime.subscribe(
          runtime,
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
}

function createCustomEventsEventedView<
  Events extends EventDetails,
  State extends EventDetails | never,
  Tag extends keyof JSX.IntrinsicElements,
>(
  tag: Tag,
  runtime: CustomEventsRuntimeState,
  sourceOwner: object,
  getState?: () => EventDetails,
): CustomEventsEventedView<Events, State, Tag> {
  type RuntimeProps = Record<string, unknown> & {
    on?: object | readonly object[]
    initial?: unknown
  }

  let wildcardSource = createWildcardEventSource(runtime, getState)

  function CustomEventsEventedView(handle: Handle<RuntimeProps>) {
    let configuredSource = handle.props.on
    let sources =
      configuredSource === undefined
        ? []
        : Array.isArray(configuredSource)
          ? configuredSource
          : [configuredSource]
    for (let source of sources) {
      let metadata = getEventSourceMetadata(source)
      if (!metadata) {
        throw new TypeError('Event-aware element on accepts event sources.')
      }
      if (metadata.owner !== sourceOwner) {
        throw new TypeError('Event sources must belong to this event model.')
      }
    }

    return () => {
      let { children, on, initial, ...elementProps } = handle.props as RuntimeProps
      return createElement(tag, {
        ...elementProps,
        children: children as RemixNode,
        eventSource: (on === undefined ? wildcardSource : on) as EventSource,
        initial,
      })
    }
  }

  return Object.assign(CustomEventsEventedView, {
    __rmxGenericJSXComponent: true as const,
  }) as unknown as CustomEventsEventedView<Events, State, Tag>
}

export function createEventedViewFactory<
  Events extends EventDetails,
  State extends EventDetails | never = never,
>(runtime: CustomEventsRuntimeState, sourceOwner: object, getState?: () => EventDetails) {
  let elements = new Map<string, unknown>()

  return <Tag extends keyof JSX.IntrinsicElements>(tag: Tag) => {
    let element = elements.get(tag)
    if (!element) {
      element = createCustomEventsEventedView<Events, State, Tag>(
        tag,
        runtime,
        sourceOwner,
        getState,
      )
      elements.set(tag, element)
    }
    return element as CustomEventsEventedView<Events, State, Tag>
  }
}
