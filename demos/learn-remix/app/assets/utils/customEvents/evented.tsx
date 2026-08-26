import { createElement, createMixin, type Handle, type RemixNode } from 'remix/ui'

import type { CustomEventInit, EventSourceMetadata } from './types.ts'

export const CUSTOM_EVENTS_SOURCE: unique symbol = Symbol('customEvents.source')

type SelectorEvent = CustomEvent<unknown>

export type EventedSource = {
  readonly [CUSTOM_EVENTS_SOURCE]: EventSourceMetadata
}

type EventedSourceInput = EventedSource | readonly (EventedSource | null | undefined)[]

type Subscription = {
  element: Element
  notify(event: SelectorEvent): unknown
}

type EventedSourceMetadata = EventSourceMetadata & {
  read?(trigger?: SelectorEvent): unknown
  subscribe(subscription: Subscription, signal: AbortSignal): void
}

function getMetadata(value: unknown): EventedSourceMetadata | undefined {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? (Reflect.get(value, CUSTOM_EVENTS_SOURCE) as EventedSourceMetadata | undefined)
    : undefined
}

function resolveSources(input: unknown): EventedSourceMetadata[] {
  let values = Array.isArray(input) ? input : [input]
  let sources: EventedSourceMetadata[] = []
  let types = new Set<string>()
  for (let value of values) {
    if (value == null) continue
    let source = getMetadata(value)
    if (!source) throw new TypeError('on accepts customEvents selectors.')
    if (types.has(source.type)) {
      throw new TypeError('An evented element accepts one selector per event type.')
    }
    types.add(source.type)
    sources.push(source)
  }
  return sources
}

function sourceValue(source: EventedSourceMetadata, event: SelectorEvent | undefined): unknown {
  if (source.read) return source.read(event)
  return event !== undefined && (source.type === '*' || event.type === source.type)
    ? event.detail
    : undefined
}

function eventInput(sources: readonly EventedSourceMetadata[], event: SelectorEvent | undefined): unknown {
  let values = sources.map((source) => sourceValue(source, event))
  return values.length === 1 ? values[0] : values
}

function initialEvent(
  sources: readonly EventedSourceMetadata[],
  initial: unknown,
): SelectorEvent | undefined {
  return sources.some((source) => source.read !== undefined)
    ? undefined
    : (initial as SelectorEvent | undefined)
}

function sameSources(
  left: readonly EventedSourceMetadata[],
  right: readonly EventedSourceMetadata[],
): boolean {
  return left.length === right.length && left.every((source, index) => source === right[index])
}

function isReactiveProp(name: string): boolean {
  return (
    name !== 'children' &&
    name !== 'key' &&
    name !== 'mix' &&
    name !== 'innerHTML' &&
    name !== 'on' &&
    name !== 'initial' &&
    !name.startsWith('on')
  )
}

function resolveProps(
  props: Record<string, unknown>,
  input: unknown,
  event: SelectorEvent | undefined,
): Record<string, unknown> {
  let resolved: Record<string, unknown> = {}
  for (let [name, value] of Object.entries(props)) {
    if (typeof value === 'function' && isReactiveProp(name)) {
      resolved[name] = (value as (input: unknown, event?: SelectorEvent) => unknown)(input, event)
    } else {
      resolved[name] = value
    }
  }
  return resolved
}

const subscribe = createMixin<
  Element,
  [sources: readonly EventedSourceMetadata[], notify: (event: SelectorEvent) => unknown]
>((handle) => {
  let element: Element | undefined
  let controller: AbortController | undefined
  let sources: readonly EventedSourceMetadata[] = []
  let notify: (event: SelectorEvent) => unknown = () => undefined

  function disconnect() {
    controller?.abort(new DOMException('', 'AbortError'))
    controller = undefined
  }

  function connect() {
    if (!element || controller || sources.length === 0) return
    controller = new AbortController()
    for (let source of sources) {
      source.subscribe({ element, notify }, controller.signal)
    }
  }

  handle.addEventListener('insert', (event) => {
    element = event.node
    connect()
  })
  handle.addEventListener('remove', () => {
    disconnect()
    element = undefined
  })

  return (nextSources, nextNotify) => {
    if (!sameSources(sources, nextSources)) {
      disconnect()
      sources = nextSources
    }
    notify = nextNotify
    connect()
    return handle.element
  }
})

type EventedProps = Record<string, unknown> & {
  on: EventedSourceInput
  initial?: unknown
  children?: RemixNode | ((input: unknown, event?: SelectorEvent) => RemixNode)
}

type EventedComponent = (handle: Handle<EventedProps>) => () => RemixNode

function createEventedElement(tag: string): EventedComponent {
  return (handle) => {
    let sources: EventedSourceMetadata[] = []
    let input: unknown
    let event: SelectorEvent | undefined
    let initialized = false
    let children: EventedProps['children']

    function EventedChildren() {
      return () => (typeof children === 'function' ? children(input, event) : children)
    }

    return () => {
      let { on, initial, children: nextChildren, mix, ...props } = handle.props
      children = nextChildren
      let nextSources = resolveSources(on)
      if (!initialized || !sameSources(sources, nextSources)) {
        sources = nextSources
        event = initialEvent(sources, initial)
        input = eventInput(sources, event)
        initialized = true
      }

      let resolvedProps = resolveProps(props, input, event)
      let hostProps = {
        ...resolvedProps,
        mix: [
          subscribe(sources, (nextEvent) => {
            event = nextEvent
            input = eventInput(sources, event)
            return handle.update()
          }),
          mix,
        ],
      }
      return createElement(tag, hostProps, createElement(EventedChildren))
    }
  }
}

const components = new Map<string, EventedComponent>()

/**
 * Event-aware elements owned by customEvents. Each tag is a cached component
 * that consumes selector props and renders the matching intrinsic element.
 */
export const customEventsEvented = new Proxy(Object.create(null), {
  get(_, property) {
    if (typeof property !== 'string') return undefined
    let component = components.get(property)
    if (!component) {
      component = createEventedElement(property)
      Object.defineProperty(component, '__rmxGenericJSXComponent', { value: true })
      components.set(property, component)
    }
    return component
  },
})

export function getEventedSource(value: unknown): EventedSourceMetadata | undefined {
  return getMetadata(value)
}

export function createViewEvent(
  type: string,
  detail: unknown,
  init: EventInit,
): CustomEvent<unknown> {
  return new CustomEvent(type, { ...init, detail })
}

export type { CustomEventInit }
