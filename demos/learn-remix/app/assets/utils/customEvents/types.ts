import type { Draft, Immutable } from 'immer'
import {
  type EVENT_SOURCE,
  type EventSourceProtocol,
  type GenericJSXComponent,
  type MixinDescriptor,
  type Props,
  type RemixNode,
  type TypedEventTarget,
} from 'remix/ui'

export type EventDetails = Record<string, unknown>

/** Payload maps and null-detail event names, which may be combined in a union. */
export type CustomEventsDefinition = EventDetails | string

type EventNames<Definition> = Definition extends string
  ? Definition
  : Definition extends EventDetails
    ? keyof Definition & string
    : never

type EventDetail<Definition, Type extends string> = Definition extends EventDetails
  ? Type extends keyof Definition
    ? Definition[Type]
    : never
  : Definition extends Type
    ? null
    : never

export type NativeDOMEventName = Extract<
  | keyof GlobalEventHandlersEventMap
  | keyof HTMLElementEventMap
  | keyof SVGElementEventMap
  | keyof DocumentEventMap
  | keyof WindowEventMap,
  string
>

type NativeNamesIn<Definition> = Extract<EventNames<Definition>, NativeDOMEventName>

/** Descriptor members that cannot be event names; the type derives from this constant. */
export const reservedCustomEventsNames = [
  'create',
  'on',
  'asHost',
  'dispatchEvent',
  'addEventListener',
  'removeEventListener',
] as const

export type ReservedCustomEventsName = (typeof reservedCustomEventsNames)[number]
type ReservedNamesIn<Definition> = Extract<EventNames<Definition>, ReservedCustomEventsName>

type NativeEventNameError<Names extends string> = {
  readonly __customEventsNativeEventNameError: 'customEvents names cannot overlap native DOM event names.'
  readonly nativeEventNames: Names
}

export type CustomEventsFactoryArgs<Definition> = [NativeNamesIn<Definition>] extends [never]
  ? [ReservedNamesIn<Definition>] extends [never]
    ? []
    : [
        error: {
          readonly __customEventsReservedNameError: 'customEvents names cannot overwrite its API.'
          readonly reservedEventNames: ReservedNamesIn<Definition>
        },
      ]
  : [error: NativeEventNameError<NativeNamesIn<Definition>>]

/**
 * Normalizes signal names and detail maps into one event-detail map.
 *
 * `"saved" | { failed: Error }` becomes
 * `{ saved: null; failed: Error }`.
 */
export type NormalizeCustomEventsDefinition<Definition extends CustomEventsDefinition> = {
  [Type in EventNames<Definition>]: EventDetail<Definition, Type>
}

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

export type CustomEventsEventType<Definition extends CustomEventsDefinition> = Exclude<
  EventNames<Definition>,
  '*' | NativeDOMEventName
>

/** Canonical event map for descriptor consumers and TypedEventTarget. */
export type CustomEventsEventMap<Definition extends CustomEventsDefinition> = {
  [Type in CustomEventsEventType<Definition>]: CustomEvent<
    NormalizeCustomEventsDefinition<Definition>[Type]
  > & { readonly type: Type }
}

// Type-only source markers; the runtime metadata symbol lives in the descriptor.
declare const onMetadata: unique symbol
declare const rememberedEventSourceMarker: unique symbol
declare const occurrenceSourceMarker: unique symbol

type EventSourceListener<Value, Type extends string, Host extends Element> = (
  event: CustomEvent<Value> & {
    readonly type: Type
    readonly currentTarget: Host
  },
) => void | Promise<unknown>

export type EventSourceMetadata<Value = unknown, Type extends string = string> = {
  type: Type
  path: readonly unknown[]
  read?: () => Value
}

export type EventSource<Value, Type extends string, Detail = Value> = {
  readonly [EVENT_SOURCE]: EventSourceProtocol
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

/** An occurrence of a remembered descriptor: value semantics, like remembered sources. */
type OccurrenceEventSource<Value, Type extends string> = EventSource<Value, Type> & {
  readonly [occurrenceSourceMarker]: true
}

export type EventSources<
  Events extends EventDetails,
  State extends EventDetails | never = never,
> = [State] extends [never]
  ? {
      readonly [Type in keyof Events & string]: EventSource<Events[Type], Type>
    }
  : {
      readonly [Type in keyof Events & string]: Type extends keyof State & string
        ? RememberedEventSource<Immutable<State>[Type], Type>
        : OccurrenceEventSource<Events[Type], Type>
    }

/**
 * True when a source (or any member of a source array) belongs to a
 * remembered descriptor: remembered sources and occurrences both read value
 * semantics.
 */
export type IsRememberedEventSource<Source> = Source extends readonly (infer Item)[]
  ? [true] extends [IsRememberedEventSource<Item>]
    ? true
    : false
  : Source extends
        | { readonly [rememberedEventSourceMarker]: true }
        | { readonly [occurrenceSourceMarker]: true }
    ? true
    : false

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
          | CustomEventsReactiveProp<
              Direct extends true ? Input : NoInfer<Input>,
              Event,
              Props<Tag>[Key]
            >
    : Props<Tag>[Key]
} & {
  [Key in `data-${string}`]?:
    | string
    | undefined
    | CustomEventsReactiveProp<
        Direct extends true ? Input : NoInfer<Input>,
        Event,
        string | undefined
      >
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
 * Shared props of every evented-view. Occurrence aliases pass `undefined`
 * inputs before a first match; `Initialized` gates the `initial` prop;
 * `Direct` skips `NoInfer` for union inputs.
 */
type CustomEventsViewProps<
  On,
  Input,
  Event,
  Tag extends keyof JSX.IntrinsicElements,
  Initial,
  Initialized extends boolean,
  Direct extends boolean = false,
> = Omit<
  CustomEventsReactiveElementProps<Input, EventedViewEvent<Event, Tag>, Tag, Direct>,
  'children' | 'on'
> & {
  on: On
  children?:
    | CustomEventsIntrinsicChildren<Tag>
    | CustomEventsReactiveProp<
        Direct extends true ? Input : NoInfer<Input>,
        EventedViewEvent<Event, Tag>,
        RemixNode
      >
} & (Initialized extends true ? { initial: Initial } : { initial?: never })

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
  readonly [EVENT_SOURCE]: EventSourceProtocol & { readonly type: '*' }
  readonly [onMetadata]: EventSourceMetadata<Immutable<State>, string>
} & (<Host extends Element = Element>(
  listener: EventSourceListener<Immutable<State>, '*', Host>,
) => MixinDescriptor<Host, any>)

/** The detail selected by a source (or tuple of sources, index-aligned with `on`). */
type CustomEventsSourceDetail<Source> = Source extends readonly unknown[]
  ? { [Index in keyof Source]: CustomEventsSourceDetail<Source[Index]> }
  : Source extends EventSource<infer Value, any, any>
    ? Value
    : never

/** The matched event of a state wildcard view: any declared event or an implicit occurrence. */
type CustomEventsWildcardEvent<Events extends EventDetails> =
  | CustomEventsEventMap<Events>[CustomEventsEventType<Events>]
  | (CustomEvent<unknown> & { readonly type: string })

/**
 * The descriptor's root event: `events.root` matches every descriptor event
 * and reads the whole composite on a remembered descriptor. Invoking it
 * scopes an element-owned effect to the root event, like the wildcard
 * `on['*'](listener)`.
 */
export type CustomEventsRootSource<
  Events extends EventDetails,
  State extends EventDetails,
> = EventSource<Immutable<State>, 'root', CustomEventsWildcardEvent<Events>> & {
  readonly [rememberedEventSourceMarker]: true
}

/** Default `on`-omitted element on an occurrence descriptor: subscribes to every event. */
type CustomEventsDefaultElementProps<
  Events extends EventDetails,
  Tag extends keyof JSX.IntrinsicElements,
  Initialized extends boolean,
> = CustomEventsViewProps<
  CustomEventsWildcardSource<Events>,
  Events[CustomEventsEventType<Events>] | (Initialized extends true ? never : undefined),
  CustomEventsEventMap<Events>[CustomEventsEventType<Events>],
  Tag,
  CustomEventsEventMap<Events>[CustomEventsEventType<Events>],
  Initialized
>

/** Default `on`-omitted element on a remembered descriptor: subscribes to every event. */
type CustomEventsRememberedDefaultElementProps<
  Events extends EventDetails,
  State extends EventDetails,
  Tag extends keyof JSX.IntrinsicElements,
> = CustomEventsViewProps<
  CustomEventsWildcardSource<Events, State>,
  Immutable<State>,
  CustomEventsWildcardEvent<Events>,
  Tag,
  never,
  false
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
  Tag,
  never,
  false
>

/** Evented-view on an occurrence source: the input is the detail, `undefined` before a match. */
type CustomEventsOccurrenceProps<
  Source,
  Tag extends keyof JSX.IntrinsicElements,
  Initialized extends boolean,
> = CustomEventsViewProps<
  Source,
  CustomEventsSourceDetail<Source> | (Initialized extends true ? never : undefined),
  CustomEventsSourceEvent<Source>,
  Tag,
  CustomEventsSourceEvent<Source>,
  Initialized,
  true
>

/**
 * Event-aware intrinsic element that re-renders from matched events. The type
 * is a type-only alias over the intrinsic tag: `evented.button` is the string
 * `'button'` at runtime, so JSX creates a host element directly, while these
 * overloads preserve source-specific callback inference.
 *
 * The wildcard overloads infer the event map from the `on` descriptor
 * itself, so the shared top-level `evented` value stays fully typed for every
 * descriptor without binding at the property-access site. Explicit sources
 * resolve to value semantics when they come from a remembered descriptor and
 * event semantics otherwise.
 */
export type CustomEventsEventedView<
  Events extends EventDetails,
  State extends EventDetails | never,
  Tag extends keyof JSX.IntrinsicElements,
> = Tag &
  GenericJSXComponent & {
    <const Source extends CustomEventsWildcardSource<EventDetails>>(
      props: { readonly on: Source } & (Source extends CustomEventsDescriptor<
        infer ViewEvents,
        infer ViewState
      >
        ? [ViewState] extends [never]
          ? CustomEventsDefaultElementProps<ViewEvents, Tag, boolean>
          : CustomEventsRememberedDefaultElementProps<ViewEvents, ViewState, Tag>
        : never),
    ): RemixNode
    <const Source extends SourceSelection<EventSource<any, any, any>>>(
      props: IsRememberedEventSource<Source> extends true
        ? CustomEventsRememberedElementProps<never, never, Tag, Source>
        : never,
    ): RemixNode
    <const Source extends SourceSelection<EventSource<any, any, any>>>(
      props: IsRememberedEventSource<Source> extends true
        ? never
        : CustomEventsOccurrenceProps<Source, Tag, boolean>,
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
    input: Input | ((root: Immutable<Events>) => Input),
    init?: CustomEventInit,
  ): [keyof Input & keyof Events] extends [never]
    ? Event
    : CustomEventsEventMap<Events>[keyof Input & keyof Events & CustomEventsEventType<Events>]
}

/**
 * The descriptor's builder member: `events.create` builds a fresh event (or
 * transaction carrier) for manual dispatch on any target.
 */
export type CustomEventsBuilder<Events extends EventDetails> = {
  create: CustomEventsCreate<Events>
}

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
> = (event: CustomEventsListenerEvent<Events, Type, Target>) => void | Promise<unknown>

export type CustomEventsOnFunction<Events extends EventDetails> = {
  <HostElement extends Element = Element>(
    listener: CustomEventsListener<Events, CustomEventsEventType<Events>, HostElement>,
  ): MixinDescriptor<HostElement, any>
}

/**
 * The `events.on` surface: a pure namespace. Every declared event name
 * resolves to a callable source, and `'*'` is the wildcard effect that
 * runs for every descriptor event. Invoking a node with a listener scopes an
 * effect to its source.
 */
export type CustomEventsOnNamespace<
  Events extends EventDetails,
  State extends EventDetails | never = never,
> = { readonly '*': CustomEventsOnFunction<Events> } & EventSources<Events, State>

/** Element-host mixin factory and domain-target bridge. */
export type CustomEventsAsHost<
  Events extends EventDetails,
  State extends EventDetails | never = never,
> = {
  (): MixinDescriptor<Element, any>
  (target: EventTarget): CustomEventsDescriptor<Events, State>
}

export type CustomEventsDescriptor<
  Events extends EventDetails,
  State extends EventDetails | never = never,
> = CustomEventsBuilder<Events> &
  CustomEventsWildcardSource<Events, State> &
  TypedEventTarget<CustomEventsEventMap<Events>> & {
    /** Dispatches a native event or an event-named input on the descriptor. */
    dispatchEvent: CustomEventsDispatchEvent<Events>
    /** The effect namespace: `on['*'](listener)` is the wildcard, `on.<name>(listener)` scopes one. */
    on: CustomEventsOnNamespace<Events, State>
    /** Registers an element host (mixin) or a domain `EventTarget` (bridge). */
    asHost: CustomEventsAsHost<Events, State>
    /** The root event source: matches every descriptor event and reads the composite. */
  } & ([State] extends [never] ? {} : { root: CustomEventsRootSource<Events, State> })

/**
 * How a declared fold event folds into the root event: the first parameter
 * is the fold event's own detail, the second the root composite as an
 * Immer draft.
 */
export type RememberedFold<Held extends EventDetails, Detail = unknown> = (
  detail: Detail,
  root: Draft<Held>,
) => void

/**
 * How a declared transient occurrence is written: a single-parameter recipe
 * fires its event with a detail and forgets it, leaving the composite
 * untouched. Declared occurrences are typed and addressable like folds, but
 * never produce patches.
 */
export type RememberedOccurrence<Detail = unknown> = (detail: Detail) => void

/**
 * A recipe in a root-less declaration: it names a transient occurrence, whose
 * detail is the first parameter (or `null` when the recipe takes none). Fold
 * recipes (two parameters) require a remembered composite and are rejected at
 * runtime.
 */
export type DeclaredOccurrence = (...args: any[]) => unknown

/** The event map of a root-less declaration: one occurrence per recipe. */
export type DeclaredOccurrences<Declaration> = {
  [Name in keyof Declaration & string]: Declaration[Name] extends (...args: any[]) => unknown
    ? [Parameters<Declaration[Name]>['length']] extends [0]
      ? null
      : Declaration[Name] extends (detail: infer Detail) => any
        ? Detail
        : unknown
    : unknown
}

/**
 * A handler of a composite descriptor: folds its own detail into the
 * composite, either synchronously against a draft or asynchronously through
 * progressive sessions.
 */
export type CompositeHandler<Composite extends EventDetails, Detail = unknown> = (
  detail: Detail,
  composite: Draft<Composite>,
) => void | Promise<void>

/** The detail a handler carries: its first parameter, or `null` when detail-less. */
type CompositeHandlerDetail<Handler> = Handler extends (...args: infer Args) => any
  ? Args extends [infer Detail, ...any[]]
    ? Detail
    : null
  : null

/** The event map of a composite descriptor: immutable slices and handler details. */
export type CompositeEvents<
  Composite extends EventDetails,
  Handlers extends Record<string, CompositeHandler<Composite, any>>,
> = Omit<
  { [Key in keyof Composite & string]: Immutable<Composite[Key]> },
  keyof Handlers & string
> & {
  [Key in keyof Handlers & string]: CompositeHandlerDetail<Handlers[Key]>
}

/** The dispatch surface of a composite descriptor: the event-named input or a function of the composite. */
type CompositeDispatch<Events extends EventDetails, Composite extends EventDetails> = {
  (
    input: { root?: { [K in keyof Composite]?: Immutable<Composite[K]> } } & {
      [K in keyof Events]?: Events[K]
    },
    init?: CustomEventInit,
  ): Promise<void>
  (
    input: (composite: Immutable<Composite>) => {
      root?: { [K in keyof Composite]?: Immutable<Composite[K]> }
    } & {
      [K in keyof Events]?: Events[K]
    },
    init?: CustomEventInit,
  ): Promise<void>
} & CustomEventsDispatchEvent<Events>

/** Runs a mounted-element effect for every descriptor event, including implicit occurrences. */
export type CompositeOnFunction = CustomEventsOnFunction<EventDetails>

/** A composite descriptor: immutable slices and handlers over the live composite. */
export type CustomEventsCompositeDescriptor<
  Composite extends EventDetails,
  Handlers extends Record<string, CompositeHandler<Composite, any>>,
> = Omit<CustomEventsDescriptor<CompositeEvents<Composite, Handlers>, Composite>, 'on' | 'root'> & {
  dispatchEvent: CompositeDispatch<CompositeEvents<Composite, Handlers>, Composite>
  on: { readonly '*': CompositeOnFunction } & CustomEventsOnNamespace<
    CompositeEvents<Composite, Handlers>,
    Composite
  >
  readonly [rememberedEventSourceMarker]: true
} & (<Host extends Element = Element>(
    listener: EventSourceListener<Immutable<Composite>, '*', Host>,
  ) => MixinDescriptor<Host, any>)
