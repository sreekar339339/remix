import type { CommittedHostNode, ReconcileContext } from './vnode.ts'

/**
 * Brand symbol marking an object as an event source consumable by the
 * `on` host prop. Registered globally so sources created by separate
 * package copies interoperate.
 */
export const EVENT_SOURCE: unique symbol = Symbol.for('rmx:event-source')

/**
 * Event payload delivered to event source subscribers. Custom events satisfy
 * this shape structurally.
 */
export type EventSourceEvent = {
  /** The event type that matched the source. */
  type: string
  /** The event payload. */
  detail?: unknown
}

/**
 * A subscriber registered by an event-aware element for one event source.
 */
export interface EventSourceSubscriber {
  /**
   * Element that owns the subscription. Sources that need element scope treat
   * an absent element as scope-less.
   */
  element: Element | undefined
  /**
   * Called for each matched event. Return a promise to let the source await
   * the resulting element update.
   */
  notify(event: EventSourceEvent): unknown
}

/**
 * Subscription behavior an event source exposes to event-aware elements.
 */
export interface EventSourceProtocol {
  /** Event type this source subscribes to. */
  readonly type: string
  /**
   * Reads the current value when the source retains one. Receives the matched
   * event when reading in response to a notification.
   */
  read?(trigger?: EventSourceEvent): unknown
  /** Subscribes a subscriber until the signal aborts. */
  subscribe(subscriber: EventSourceSubscriber, signal: AbortSignal): void
}

/**
 * An event source accepted by the `on` host prop.
 */
export interface EventSource {
  readonly [EVENT_SOURCE]: EventSourceProtocol
}

/**
 * Value accepted by the `on` host prop: one source or an array of
 * sources, with empty slots allowed for conditional composition.
 */
export type EventSourceInput = EventSource | readonly (EventSource | null | undefined)[]

/**
 * Reads the event source protocol from a value, when present.
 * @param value Value to inspect.
 * @returns The protocol, or `undefined` when the value is not an event source.
 */
export function getEventSourceProtocol(value: unknown): EventSourceProtocol | undefined {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? (Reflect.get(value, EVENT_SOURCE) as EventSourceProtocol | undefined)
    : undefined
}

/**
 * Extracts and validates event source protocols from an `on` prop
 * value. Empty slots are skipped; any other non-source value throws.
 * @param input The `on` prop value.
 * @returns The validated source protocols.
 */
export function resolveEventSourceProtocols(input: unknown): EventSourceProtocol[] {
  let values = Array.isArray(input) ? input : [input]
  let sources: EventSourceProtocol[] = []
  let types = new Set<string>()
  for (let value of values) {
    if (value == null) continue
    let protocol = getEventSourceProtocol(value)
    if (!protocol) {
      throw new TypeError('on accepts event sources.')
    }
    if (types.has(protocol.type)) {
      throw new TypeError('An event-aware element accepts one source per event type.')
    }
    types.add(protocol.type)
    sources.push(protocol)
  }
  return sources
}

function computeSourceDetail(
  source: EventSourceProtocol,
  trigger: EventSourceEvent | undefined,
): unknown {
  if (source.read) return source.read(trigger)
  return trigger !== undefined && (source.type === '*' || trigger.type === source.type)
    ? trigger.detail
    : undefined
}

function computeEventDetail(
  trigger: EventSourceEvent | undefined,
  sources: readonly EventSourceProtocol[],
): unknown {
  if (sources.length === 1) return computeSourceDetail(sources[0]!, trigger)
  return sources.map((source) => computeSourceDetail(source, trigger))
}

function hasRetainedSource(sources: readonly EventSourceProtocol[]): boolean {
  return sources.some((source) => source.read !== undefined)
}

/**
 * Computes the value callbacks receive when an event-aware element mounts.
 * Each source fills its slot as if the `initial` event had just matched:
 * sources that retain a value read it directly, occurrence slots take the
 * initial event's detail when its type matches, and `undefined` otherwise.
 * @param sources Validated source protocols.
 * @param initial The `initial` prop value.
 * @returns The initial callback input.
 */
export function computeInitialEventInput(
  sources: readonly EventSourceProtocol[],
  initial: unknown,
): unknown {
  return computeEventDetail(initial as EventSourceEvent | undefined, sources)
}

/**
 * Computes the event delivered to callbacks when an event-aware element
 * mounts. Only views whose sources all retain nothing receive the initial
 * event; sources that retain a value have no event to report.
 * @param sources Validated source protocols.
 * @param initial The `initial` prop value.
 * @returns The initial event, when the element is occurrence-driven.
 */
export function computeInitialEvent(
  sources: readonly EventSourceProtocol[],
  initial: unknown,
): EventSourceEvent | undefined {
  return hasRetainedSource(sources) ? undefined : (initial as EventSourceEvent | undefined)
}

/**
 * Computes the value callbacks receive after a matched event.
 * @param sources Validated source protocols.
 * @param trigger The matched event.
 * @returns The callback input for the event.
 */
export function computeNotifyEventInput(
  sources: readonly EventSourceProtocol[],
  trigger: EventSourceEvent,
): unknown {
  return computeEventDetail(trigger, sources)
}

function isNonReactiveProp(key: string): boolean {
  return (
    key === 'children' ||
    key === 'key' ||
    key === 'mix' ||
    key === 'innerHTML' ||
    key === 'on' ||
    key === 'initial' ||
    key.startsWith('on')
  )
}

/**
 * The reactive prop keys of a raw prop bag: function-valued props the
 * evented element resolves against its event input. Cached per element so
 * notifications resolve props without rescanning every key.
 */
export function collectReactivePropKeys(props: Record<string, unknown>): string[] | undefined {
  let keys: string[] | undefined
  for (let key of Object.keys(props)) {
    if (typeof props[key] === 'function' && !isNonReactiveProp(key)) {
      ;(keys ??= []).push(key)
    }
  }
  return keys
}

/**
 * Resolves reactive element props: function-valued props are called with the
 * callback input and the matched event, everything else passes through
 * unchanged. When a cached key list is supplied, only those keys are visited.
 * @param props Props to resolve.
 * @param input The callback input.
 * @param event The matched event, when the element is occurrence-driven.
 * @param reactiveKeys Cached reactive keys of `props`, when known.
 * @returns The resolved props.
 */
export function resolveEventedProps(
  props: Record<string, unknown>,
  input: unknown,
  event?: EventSourceEvent,
  reactiveKeys?: readonly string[],
): Record<string, unknown> {
  let keys = reactiveKeys ?? collectReactivePropKeys(props)
  if (!keys) return props
  let resolved: Record<string, unknown> | undefined
  for (let key of keys) {
    resolved ??= { ...props }
    resolved[key] = (props[key] as (input: unknown, event?: EventSourceEvent) => unknown)(
      input,
      event,
    )
  }
  return resolved ?? props
}

/**
 * State owned by a committed event-aware host element.
 */
export type EventedHostState = {
  /** Validated source protocols extracted from the `on` prop. */
  sources: EventSourceProtocol[]
  /** Current callback input; re-computed on every matched event. */
  input: unknown
  /** The matched event; present when an occurrence source matches. */
  event?: EventSourceEvent
  /** Mixin-resolved props with reactive callbacks still intact. */
  rawProps: Record<string, unknown>
  /** Reactive prop keys of `rawProps`, resolved on adoption. */
  reactiveKeys?: readonly string[]
  /** Raw children value: a callback of the event input or static nodes. */
  rawChildren: unknown
  /** Reconcile context captured at setup, used by event-driven updates. */
  context: ReconcileContext
  /** Live committed vnode, assigned on every commit after setup. */
  node?: CommittedHostNode
  /** Subscription lifetime; aborted when the element is removed. */
  controller: AbortController
  /** Whether an update is already queued with the scheduler. */
  pending: boolean
  /** Resolvers waiting for the next committed update. */
  waiters: Array<() => void>
}

/**
 * Creates the evented state for a mounting host element.
 * @param sources Validated source protocols.
 * @param rawProps Mixin-resolved props with reactive callbacks intact.
 * @param initial The `initial` prop value.
 * @param context Reconcile context for event-driven updates.
 * @returns The new evented host state.
 */
export function createEventedHostState(
  sources: EventSourceProtocol[],
  rawProps: Record<string, unknown>,
  initial: unknown,
  context: ReconcileContext,
): EventedHostState {
  return {
    sources,
    input: computeInitialEventInput(sources, initial),
    event: computeInitialEvent(sources, initial),
    rawProps,
    reactiveKeys: collectReactivePropKeys(rawProps),
    rawChildren: rawProps.children,
    context,
    controller: new AbortController(),
    pending: false,
    waiters: [],
  }
}

/**
 * Subscribes a host element to its event sources. Each notification updates
 * the callback input and returns a promise settled after the element update
 * commits.
 * @param element Element owning the subscriptions.
 * @param state Evented host state.
 * @param update Schedules an element update; resolves after the commit.
 */
export function subscribeEventedHostNode(
  element: Element,
  state: EventedHostState,
  update: () => Promise<void>,
): void {
  for (let source of state.sources) {
    source.subscribe(
      {
        element,
        notify(event) {
          state.input = computeNotifyEventInput(state.sources, event)
          state.event = event
          return update()
        },
      },
      state.controller.signal,
    )
  }
}
