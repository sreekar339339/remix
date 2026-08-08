import type { MixinDescriptor } from 'remix/ui'
import {
  EVENT_SOURCE,
  type EventSourceEvent,
  type EventSourceProtocol,
  type EventSourceSubscriber,
} from 'remix/ui'
import { canonicalAddressSegment } from './runtime.ts'

const eventSourceMetadata: unique symbol = Symbol('eventSource')
export const stateEventSourceMarker: unique symbol = Symbol('stateEventSource')
const storeOccurrenceSourceMarker: unique symbol = Symbol('storeOccurrenceSource')

/**
 * True when a source (or any member of a source array) belongs to a store:
 * store-held state sources and store occurrences both read value semantics.
 */
export type IsStateEventSource<Source> = Source extends readonly (infer Item)[]
  ? [true] extends [IsStateEventSource<Item>]
    ? true
    : false
  : Source extends
        | { readonly [stateEventSourceMarker]: true }
        | { readonly [storeOccurrenceSourceMarker]: true }
    ? true
    : false

export type EventSourceMetadata<Value = unknown, Type extends string = string> = {
  owner: object
  type: Type
  path: readonly unknown[]
  read?: () => Value
}

type EventSourceListener<Value, Type extends string, Host extends Element> = (
  event: CustomEvent<Value> & {
    readonly type: Type
    readonly currentTarget: Host
  },
) => void | Promise<unknown>

export type EventSource<Value, Type extends string, Detail = Value> = {
  readonly [EVENT_SOURCE]: EventSourceProtocol
  readonly [eventSourceMetadata]: EventSourceMetadata<Value, Type>
  on<Host extends Element = Element>(
    listener: EventSourceListener<Detail, Type, Host>,
  ): MixinDescriptor<Host, any>
}

type Defined<Value> = Exclude<Value, null | undefined>
type PreserveMissing<Parent, Value> =
  Extract<Parent, null | undefined> extends never ? Value : Value | undefined

export type StateEventSource<Value, Type extends string, Detail = Value> = EventSource<
  Value,
  Type,
  Detail
> & { readonly [stateEventSourceMarker]: true } & (Defined<Value> extends ReadonlyMap<
    infer Key,
    infer Item
  >
    ? { get(key: Key): StateEventSource<Item | undefined, Type> }
    : Defined<Value> extends ReadonlySet<infer Item>
      ? { has(value: Item): StateEventSource<boolean, Type> }
      : Defined<Value> extends readonly (infer Item)[]
        ? { readonly [index: number]: StateEventSource<Item | undefined, Type> }
        : Defined<Value> extends object
          ? {
              readonly [Key in keyof Defined<Value>]: StateEventSource<
                PreserveMissing<Value, Defined<Value>[Key]>,
                Type
              >
            }
          : { as(value: Value): StateEventSource<boolean, Type, Value | null> })

/** An occurrence of a store: value semantics, like held state sources. */
type StoreOccurrenceSource<Value, Type extends string> = EventSource<Value, Type> & {
  readonly [storeOccurrenceSourceMarker]: true
}

export type EventSources<
  Events extends Record<string, unknown>,
  State extends Record<string, unknown> | never = never,
> = [State] extends [never]
  ? {
      readonly [Type in keyof Events & string]: EventSource<Events[Type], Type>
    }
  : {
      readonly [Type in keyof Events & string]: Type extends keyof State & string
        ? StateEventSource<State[Type], Type>
        : StoreOccurrenceSource<Events[Type], Type>
    }

export function getEventSourceMetadata(value: unknown) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? (Reflect.get(value, eventSourceMetadata) as EventSourceMetadata | undefined)
    : undefined
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

function readPath(value: unknown, path: readonly unknown[]) {
  for (let segment of path) {
    if (value instanceof Map) {
      if (value.has(segment)) {
        value = value.get(segment)
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

export function readEventSource({ read }: EventSourceMetadata) {
  return read?.()
}

type EffectFactory = (
  metadata: EventSourceMetadata,
  listener: (event: Event) => void | Promise<unknown>,
) => MixinDescriptor<Element, any>

type SubscriptionFactory = (
  metadata: EventSourceMetadata,
  subscriber: EventSourceSubscriber,
  signal: AbortSignal,
) => void

export function createEventSource(
  owner: object,
  type: string,
  readRoot: (() => unknown) | undefined,
  createEffect: EffectFactory,
  createSubscription: SubscriptionFactory,
  stateBacked: boolean,
  path: readonly unknown[] = [],
  read?: () => unknown,
): object {
  let metadata: EventSourceMetadata = {
    owner,
    type,
    path,
    ...(readRoot ? { read: read ?? (() => readPath(readRoot(), path)) } : {}),
  }
  let protocol: EventSourceProtocol = {
    type,
    // On a store-backed descriptor every source yields detail-shaped input:
    // held properties read their current value, while occurrences fill their
    // slot from the matched event and read undefined otherwise.
    ...(readRoot || stateBacked
      ? {
          read: metadata.read
            ? () => metadata.read!()
            : (trigger?: EventSourceEvent) =>
                trigger && trigger.type === type ? trigger.detail : undefined,
        }
      : {}),
    subscribe(subscriber, signal) {
      createSubscription(metadata, subscriber, signal)
    },
  }
  return new Proxy(Object.create(null), {
    get(_, property) {
      if (property === EVENT_SOURCE) return protocol
      if (property === eventSourceMetadata) return metadata
      if (property === 'on') {
        return (listener: (event: Event) => void | Promise<unknown>) =>
          createEffect(metadata, listener)
      }

      let current = readEventSource(metadata)
      if (property === 'get' && current instanceof Map) {
        return (key: unknown) =>
          createEventSource(owner, type, readRoot, createEffect, createSubscription, stateBacked, [
            ...path,
            canonicalAddressSegment(key),
          ])
      }
      if (property === 'has' && current instanceof Set) {
        return (value: unknown) =>
          createEventSource(owner, type, readRoot, createEffect, createSubscription, stateBacked, [
            ...path,
            canonicalAddressSegment(value),
          ])
      }
      if (property === 'as') {
        return (value: unknown) =>
          createEventSource(
            owner,
            type,
            readRoot,
            createEffect,
            createSubscription,
            stateBacked,
            [...path, canonicalAddressSegment(value)],
            readRoot ? () => samePropertyKey(readPath(readRoot(), path), value) : undefined,
          )
      }
      return createEventSource(
        owner,
        type,
        readRoot,
        createEffect,
        createSubscription,
        stateBacked,
        [...path, property],
      )
    },
  })
}
