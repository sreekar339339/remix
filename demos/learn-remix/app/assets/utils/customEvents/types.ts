/** Type-only marker distinguishing remembered sources from occurrences. */
declare const rememberedEventSourceMarker: unique symbol

import type { Draft, Immutable } from 'immer'
import {
  type MixinDescriptor,
  type Props,
  type RemixNode,
  type TypedEventTarget,
} from 'remix/ui'
import type { CUSTOM_EVENTS_SOURCE } from './evented.tsx'

export type EventDetails = Record<string, unknown>

/**
 * Init options for events created by `customEvents`: the DOM's
 * `CustomEventInit` minus `detail` and `cancelable`, plus `signal`.
 * Details are expressed by the object grammar (`create({ name: detail })`).
 * An already-aborted `signal` synchronously throws its abort reason instead
 * of creating an event.
 */
export type CustomEventInit = Omit<EventInit, 'cancelable'> & {
  /** Custom events describe completed facts and are never cancelable. */
  cancelable?: never
  /** Throws the signal's abort reason when it is already aborted. */
  signal?: AbortSignal
}

/** Event names of a detail map, excluding the `'*'` wildcard. */
export type CustomEventsEventType<Definition extends EventDetails> = Exclude<
  keyof Definition & string,
  '*'
>

/** Canonical event map for descriptor consumers and TypedEventTarget. */
export type CustomEventsEventMap<Definition extends EventDetails> = {
  [Type in CustomEventsEventType<Definition>]: CustomEvent<Definition[Type]> & {
    readonly type: Type
  }
}

/** Type-only carrier of the source's value; consumed by source-detail inference. */
declare const onMetadata: unique symbol

type EventSourceListener<Value, Type extends string, Host extends Element> = (
  event: CustomEvent<Value> & {
    readonly type: Type
    readonly currentTarget: Host
  },
  signal?: AbortSignal,
) => void | Promise<unknown>

export type EventSourceMetadata<Value = unknown, Type extends string = string> = {
  type: Type
  path: readonly unknown[]
  read?: (trigger?: CustomEvent<unknown>) => Value
  subscribe(
    subscriber: { element: Element | undefined; notify(event: CustomEvent<unknown>): unknown },
    signal: AbortSignal,
  ): void
}

export type EventSource<Value, Type extends string, Detail = Value> = {
  readonly [CUSTOM_EVENTS_SOURCE]: EventSourceMetadata<Value, Type>
  readonly [onMetadata]: EventSourceMetadata<Value, Type>
  /** Element-owned effect for this source: active only while mounted. */
  <Host extends Element = Element>(
    listener: EventSourceListener<Detail, Type, Host>,
  ): MixinDescriptor<Host, any>
}

type Defined<Value> = Exclude<Value, null | undefined>
type PreserveMissing<Parent, Value> =
  Extract<Parent, null | undefined> extends never ? Value : Value | undefined

export type RememberedEventSource<Value, Type extends string, Detail = Value> = EventSource<
  Value,
  Type,
  Detail
> & { readonly [rememberedEventSourceMarker]: true } & (Defined<Value> extends ReadonlyMap<
    infer Key,
    infer Item
  >
    ? { get(key: Key): RememberedEventSource<Item | undefined, Type> }
    : Defined<Value> extends ReadonlySet<infer Item>
      ? { has(value: Item): RememberedEventSource<boolean, Type> }
      : Defined<Value> extends readonly (infer Item)[]
        ? { readonly [index: number]: RememberedEventSource<Item | undefined, Type> }
        : Defined<Value> extends object
          ? {
              readonly [Key in keyof Defined<Value>]: RememberedEventSource<
                PreserveMissing<Value, Defined<Value>[Key]>,
                Type
              >
            }
          : { as(value: Value): RememberedEventSource<boolean, Type, Value | null> })

/** A notification of a remembered descriptor: value semantics, like remembered selectors. Transient. */
type RememberedNotificationSource<Value, Type extends string> = EventSource<Value, Type> & {
  readonly [rememberedEventSourceMarker]: true
}

export type EventSources<
  Events extends EventDetails,
  State extends EventDetails,
> = {
  readonly [Type in keyof Events & string]: Type extends keyof State & string
    ? RememberedEventSource<Immutable<State>[Type], Type>
    : RememberedNotificationSource<Events[Type], Type>
}

type CustomEventsReactiveProp<Input, Event, Value> = (input: Input, event: Event) => Value

/**
 * Reactive props for an evented-view; `Direct` skips `NoInfer` so callbacks
 * may destructure union inputs (occurrence views).
 */
type CustomEventsReactiveElementProps<
  Input,
  Event,
  Tag extends keyof JSX.IntrinsicElements,
  Direct extends boolean = false,
> = {
  [Key in keyof Props<Tag>]: Key extends string
    ? Key extends 'children' | 'key' | 'mix' | 'ref' | 'on' | `on${string}`
      ? Props<Tag>[Key]
      :
          | Props<Tag>[Key]
          | CustomEventsReactiveProp<NoInfer<Input>, Event, Props<Tag>[Key]>
    : Props<Tag>[Key]
} & {
  [Key in `data-${string}`]?:
    | string
    | undefined
    | CustomEventsReactiveProp<NoInfer<Input>, Event, string | undefined>
}

type CustomEventsIntrinsicChildren<Tag extends keyof JSX.IntrinsicElements> =
  Props<Tag> extends { children?: infer Children } ? Children : RemixNode

/** The DOM element type a JSX intrinsic tag creates. */
type IntrinsicElementOf<Tag extends keyof JSX.IntrinsicElements> =
  Tag extends keyof HTMLElementTagNameMap
    ? HTMLElementTagNameMap[Tag]
    : Tag extends keyof SVGElementTagNameMap
      ? SVGElementTagNameMap[Tag]
      : Tag extends keyof MathMLElementTagNameMap
        ? MathMLElementTagNameMap[Tag]
        : Element

/** The matched event of an evented-view callback, owned by its element. */
type EventedViewEvent<Event, Tag extends keyof JSX.IntrinsicElements> = Event & {
  readonly currentTarget: IntrinsicElementOf<Tag> | null
}

/**
 * Shared props of every evented-view: the selected `on` sources, reactive
 * props and children over the callback input, and no `initial` (remembered
 * views need none).
 */
type CustomEventsViewProps<
  On,
  Input,
  Event,
  Tag extends keyof JSX.IntrinsicElements,
> = Omit<
  CustomEventsReactiveElementProps<Input, EventedViewEvent<Event, Tag>, Tag>,
  'children' | 'on'
> & {
  on: On
  children?:
    | CustomEventsIntrinsicChildren<Tag>
    | CustomEventsReactiveProp<NoInfer<Input>, EventedViewEvent<Event, Tag>, RemixNode>
} & { initial?: never }

type SourceSelection<Source> = Source | readonly Source[]

type CustomEventsSourceEvent<Source> = Source extends readonly (infer Item)[]
  ? CustomEventsSourceEvent<Item>
  : Source extends EventSource<infer Value, infer Type, any>
    ? CustomEvent<Value> & { readonly type: Type }
    : never

/**
 * The descriptor itself, used as the wildcard event source: subscribing to it
 * matches every descriptor event. On a remembered descriptor it reads the
 * whole composite for every matched event.
 */
export type CustomEventsWildcardSource<
  Events extends EventDetails,
  State extends EventDetails | never = never,
> = {
  readonly [CUSTOM_EVENTS_SOURCE]: EventSourceMetadata<Immutable<State>, '*'>
  readonly [onMetadata]: EventSourceMetadata<Immutable<State>, string>
}

/** The detail selected by a source (or tuple of sources, index-aligned with `on`). */
type CustomEventsSourceDetail<Source> = Source extends readonly unknown[]
  ? { [Index in keyof Source]: CustomEventsSourceDetail<Source[Index]> }
  : Source extends EventSource<infer Value, any, any>
    ? Value
    : never

/** The matched event of a state wildcard view: the union of every declared
 * event, discriminated by `type` so callbacks can narrow the detail. */
type CustomEventsWildcardEvent<Events extends EventDetails> =
  CustomEventsEventMap<Events>[CustomEventsEventType<Events>]

/** Default `on`-omitted element on a remembered descriptor: subscribes to every event. */
type CustomEventsRememberedDefaultElementProps<
  Events extends EventDetails,
  State extends EventDetails,
  Tag extends keyof JSX.IntrinsicElements,
> = CustomEventsViewProps<
  CustomEventsWildcardSource<Events, State>,
  Immutable<State>,
  CustomEventsWildcardEvent<Events>,
  Tag
>

/** Evented-view on a remembered descriptor: `on` selects sources; the input is their value(s). */
type CustomEventsRememberedElementProps<
  Events extends EventDetails,
  State extends EventDetails,
  Tag extends keyof JSX.IntrinsicElements,
  Source,
> = CustomEventsViewProps<
  Source,
  CustomEventsSourceDetail<Source>,
  CustomEventsSourceEvent<Source>,
  Tag
>

/**
 * Event-aware intrinsic element that re-renders from matched events. The type
 * is a cached component that renders the matching intrinsic tag while these
 * overloads preserve source-specific callback inference.
 *
 * The wildcard overloads infer the event map from the `on` descriptor
 * itself, so the shared top-level `evented` value stays fully typed for every
 * descriptor without binding at the property-access site. Explicit sources
 * resolve to value semantics when they come from a remembered descriptor and
 * event semantics otherwise.
 */
type GenericEventedComponent = {
  readonly __rmxGenericJSXComponent: true
}

export type CustomEventsEventedView<
  Events extends EventDetails,
  State extends EventDetails | never,
  Tag extends keyof JSX.IntrinsicElements,
> = GenericEventedComponent & {
    <const Source extends CustomEventsOnFunction<EventDetails, EventDetails>>(
      props: Source extends CustomEventsOnFunction<infer ViewEvents, infer ViewState>
        ? {
            readonly on: Source
          } & CustomEventsRememberedDefaultElementProps<ViewEvents, ViewState, Tag>
        : never,
    ): RemixNode
    <const Source extends CustomEventsWildcardSource<EventDetails>>(
      props: { readonly on: Source } & (Source extends CustomEventsDescriptor<
        infer ViewEvents,
        infer ViewState
      >
        ? CustomEventsRememberedDefaultElementProps<ViewEvents, ViewState, Tag>
        : never),
    ): RemixNode
    <const Source extends object & { readonly on: unknown }>(
      props: Source extends {
        on: CustomEventsOnNamespace<infer ViewEvents, infer ViewState>
      }
        ? {
            readonly on: Source
          } & Omit<CustomEventsRememberedDefaultElementProps<ViewEvents, ViewState, Tag>, 'on'> & {
            initial?: unknown
          }
        : never,
    ): RemixNode
    <const Source extends SourceSelection<EventSource<any, any, any>>>(
      props: CustomEventsRememberedElementProps<never, never, Tag, Source>,
    ): RemixNode

  }

export type CustomEventsEventedViews<
  Events extends EventDetails,
  State extends EventDetails | never = never,
> = {
  [Tag in keyof JSX.IntrinsicElements]: CustomEventsEventedView<Events, State, Tag>
}

type NullDetailEventTypes<Events extends EventDetails> = {
  [Type in keyof Events & string]: [Events[Type]] extends [null] ? Type : never
}[keyof Events & string]

/**
 * The build surface: `create('name', init?)` for detail-less events, and
 * `create({ name: detail, ... }, init?)` or `create((root) => input, init?)`
 * for one or more event-named details committed as a single transaction. The
 * object form returns the matched event(s): the single declared event for one
 * key, the event union for several, and a plain event for undeclared
 * occurrence names.
 */
export type CustomEventsCreate<Events extends EventDetails> = {
  <Type extends NullDetailEventTypes<Events> & CustomEventsEventType<Events>>(
    type: Type,
    init?: CustomEventInit,
  ): CustomEventsEventMap<Events>[Type]
} & {
  <
    const Input extends {
      [K in keyof Events]?: Events[K]
    } & { root?: unknown },
  >(
    input: Input,
    init?: CustomEventInit,
  ): [keyof Input & keyof Events] extends [never]
    ? Event
    : CustomEventsEventMap<Events>[keyof Input & keyof Events & CustomEventsEventType<Events>]
}

/**
 * The descriptor's builder member: `events.create` builds a fresh event (or
 * transaction carrier) for manual dispatch on any target.
 */
/**
 * The unified dispatch surface of a descriptor, which carries a native
 * `EventTarget` channel: dispatching a native `Event` fires it on the
 * descriptor (returning `boolean`), while an event-named input dispatches on
 * the descriptor and resolves after view updates and effects settle. The
 * object form names declared events; the bare-name form and the native
 * channel dispatch any name as a transient occurrence.
 */
export type CustomEventsDispatchEvent<Events extends EventDetails = EventDetails> = {
  (event: Event): boolean
  (input: string | Partial<Events>, init?: CustomEventInit): Promise<void>
}

export type CustomEventsListenerEvent<
  Events extends EventDetails,
  Type extends CustomEventsEventType<Events>,
  Target extends EventTarget,
> =
  Type extends CustomEventsEventType<Events>
    ? Omit<CustomEventsEventMap<Events>[Type], 'currentTarget'> & {
        readonly currentTarget: Target
      }
    : never

type CustomEventsListener<
  Events extends EventDetails,
  Type extends CustomEventsEventType<Events>,
  Target extends EventTarget,
> = (
  event: CustomEventsListenerEvent<Events, Type, Target>,
  signal?: AbortSignal,
) => void | Promise<unknown>

/** The wildcard on a descriptor: calling it with a listener scopes an
 * element-owned effect to every descriptor event, and the value doubles as
 * a view source reading the whole composite (`on={events.on['*']}`). */
export type CustomEventsOnFunction<
  Events extends EventDetails,
  State extends EventDetails = Events,
> = {
  <HostElement extends Element = Element>(
    listener: CustomEventsListener<Events, CustomEventsEventType<Events>, HostElement>,
  ): MixinDescriptor<HostElement, any>
} & CustomEventsWildcardSource<Events, State>

/**
 * The `events.on` surface: a pure namespace. Every declared event name
 * resolves to a callable source, and `'*'` is the wildcard effect that
 * runs for every descriptor event. Invoking a node with a listener scopes an
 * effect to its source.
 */
export type CustomEventsOnNamespace<
  Events extends EventDetails,
  State extends EventDetails,
> = { readonly '*': CustomEventsOnFunction<Events, State> } & EventSources<Events, State>

/** Element-host mixin factory and domain-target bridge. */
export type CustomEventsAsHost<
  Events extends EventDetails,
  State extends EventDetails,
> = {
  (): MixinDescriptor<Element, any>
  (target: EventTarget): CustomEventsDescriptor<Events, State>
}

export type CustomEventsDescriptor<
  Events extends EventDetails,
  State extends EventDetails,
> = CustomEventsWildcardSource<Events, State> &
  TypedEventTarget<CustomEventsEventMap<Events>> & {
    /** Builds typed events for any target: a bare name, an object of details. */
    create: CustomEventsCreate<Events>
    /** Dispatches a native event or an event-named input on the descriptor. */
    dispatchEvent: CustomEventsDispatchEvent<Events>
    /** The effect namespace: `on['*'](listener)` is the wildcard, `on.<name>(listener)` scopes one. */
    on: CustomEventsOnNamespace<Events, State>
    /** Registers an element host (mixin) or a domain `EventTarget` (bridge). */
    asHost: CustomEventsAsHost<Events, State>
  }

/** The event names of a defined composite's class: every own key except
 * the constructor; function values are folds, the rest are held slices. */
type MemberKeys<X> = keyof X & string

type HeldKeys<X> = {
  [Key in MemberKeys<X>]: X[Key] extends (...args: any[]) => any ? never : Key
}[MemberKeys<X>]

type FoldKeys<X> = {
  [Key in MemberKeys<X>]: X[Key] extends (...args: any[]) => any ? Key : never
}[MemberKeys<X>]

/** The current details of a defined class: its remembered events (non-function members). */
export type DetailsOf<X> = { [Key in HeldKeys<X>]: X[Key] }

/** The handler events of a defined class: its methods, keyed by name.
 * Zero-parameter handlers are detail-less: their detail is `null`. */
export type HandlersOf<X> = {
  [Key in FoldKeys<X>]: X[Key] extends (...args: infer Args) => any
    ? Args extends [infer Detail, ...any[]]
      ? (detail: Detail, composite: Draft<DetailsOf<X>>) => void | Promise<void>
      : (detail: null, composite: Draft<DetailsOf<X>>) => void | Promise<void>
    : never
}

/**
 * A handler over details: its detail is the first parameter, the
 * remembered details arrive as an Immer draft.
 */
export type DetailsHandler<Details extends EventDetails, Detail = unknown> = (
  detail: Detail,
  composite: Draft<Details>,
) => void | Promise<void>

/** The detail a handler carries: its first parameter, or `null` when detail-less. */
type CompositeHandlerDetail<Handler> = Handler extends (...args: infer Args) => any
  ? Args extends [infer Detail, ...any[]]
    ? Detail
    : null
  : null

/** The event map from remembered details and handlers. */
export type EventMapFrom<
  Details extends EventDetails,
  Handlers extends Record<string, DetailsHandler<Details, any>>,
> = Omit<
  { [Key in keyof Details & string]: Immutable<Details[Key]> },
  keyof Handlers & string
> & {
  [Key in keyof Handlers & string]: CompositeHandlerDetail<Handlers[Key]>
}

/** A source in the class reaction namespace: calling it with a callback
 * registers a session reaction; nested accessors mirror the selector
 * namespace, so deep paths react to the value at that address. The `This`
 * parameter is the runner-bound `this` of the callback: the session composite
 * draft at the root, narrowed to the item at each nested path. Property
 * writes through `this` are dropped once the run's signal has aborted —
 * a superseded derivation never commits; reads stay live. */
export type CustomEventsReactionSource<Value, Type extends string, This> = {
  (
    callback: (
      this: This,
      event: CustomEvent<Value> & { readonly type: Type },
      signal?: AbortSignal,
    ) => void,
  ): void
} & (Defined<Value> extends ReadonlyMap<infer Key, infer Item>
  ? { get(key: Key): CustomEventsReactionSource<Item | undefined, Type, Draft<Defined<Item>>> }
  : Defined<Value> extends ReadonlySet<infer Item>
    ? { has(value: Item): CustomEventsReactionSource<boolean, Type, Draft<boolean>> }
    : Defined<Value> extends readonly (infer Item)[]
      ? {
          readonly [index: number]: CustomEventsReactionSource<
            Item | undefined,
            Type,
            Draft<Defined<Item>>
          >
        }
      : Defined<Value> extends object
        ? {
            readonly [Key in keyof Defined<Value>]: CustomEventsReactionSource<
              PreserveMissing<Value, Defined<Value>[Key]>,
              Type,
              Draft<Defined<Value>[Key]>
            >
          }
        : { as(value: Value): CustomEventsReactionSource<boolean, Type, Draft<boolean>> })

/** The class reaction surface: `defineEvents` passes it to the class
 * constructor, and `api.on.<slice>(callback)` registers a session reaction
 * for that slice's writes. Field-level callbacks bind `this` to the session
 * composite draft; deep paths narrow it to the item at the path. `api.create`
 * mirrors the descriptor's `create`, so reaction callbacks build typed events
 * for any target without closing over the defined instance. */
export type EventsApi<X extends object> = {
  readonly on: {
    readonly '*': (callback: (event: Event) => void) => void
  } & {
    readonly [Type in keyof DetailsOf<X> & string]: CustomEventsReactionSource<
      DetailsOf<X>[Type],
      Type,
      Draft<DetailsOf<X>>
    >
  }
  /**
   * Builds typed events for any target: a bare name or an object of details,
   * exactly like `events.create`. Handlers fold eagerly at call time, so call it from
   * quiesced continuations (after an `await`) rather than between a draft
   * mutation and its flush.
   */
  readonly create: CustomEventsCreate<EventMapFrom<DetailsOf<X>, HandlersOf<X>>>
}

/** The dispatch surface of a composite descriptor: the event-named input. */
export type CompositeDispatch<Events extends EventDetails> = {
  (
    input: { [K in keyof Events]?: Events[K] },
    init?: CustomEventInit,
  ): Promise<void>
} & CustomEventsDispatchEvent<Events>

/** The typed event map of a defined events class: its remembered and handler
 * details as `CustomEvent` listener types, for `TypedEventTarget` hosts. */
export type EventsMapOf<X extends object> = CustomEventsEventMap<
  EventMapFrom<DetailsOf<X>, HandlersOf<X>>
>

/** The union of a defined class's events: every remembered and handler detail as a
 * typed `CustomEvent` with its `type`. */
export type EventsOf<X extends object> = EventsMapOf<X>[keyof EventsMapOf<X>]

/** The event surface of a defined events class: the descriptor machinery plus
 * the live current details, read through `events.details`. */
export type CustomEventsDefined<X extends object> = CustomEventsCompositeDescriptor<
  DetailsOf<X>,
  HandlersOf<X>
> & { readonly details: DetailsOf<X> }

/** A remembered-events descriptor: remembered details and handlers over the live current details. */
export type CustomEventsCompositeDescriptor<
  Details extends EventDetails,
  Handlers extends Record<string, DetailsHandler<Details, any>>,
> = Omit<
  CustomEventsDescriptor<EventMapFrom<Details, Handlers>, Details>,
  'on'
> & {
  dispatchEvent: CompositeDispatch<EventMapFrom<Details, Handlers>>
  on: CustomEventsOnNamespace<EventMapFrom<Details, Handlers>, Details>
  readonly [rememberedEventSourceMarker]: true
}
