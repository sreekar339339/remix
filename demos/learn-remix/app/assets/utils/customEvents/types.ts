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
 * Normalizes signal names and payload maps into one event-detail map.
 *
 * `"saved" | { failed: Error }` becomes
 * `{ saved: null; failed: Error }`.
 */
export type NormalizeCustomEventsDefinition<Definition extends CustomEventsDefinition> = {
  [Type in EventNames<Definition>]: EventDetail<Definition, Type>
}

/**
 * Options for events created by `customEvents`.
 *
 * These include the standard propagation flags except `cancelable`.
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
declare const eventSourceMetadata: unique symbol
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
  readonly [eventSourceMetadata]: EventSourceMetadata<Value, Type>
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
        ? RememberedEventSource<State[Type], Type>
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
  CustomEventsReactiveElementProps<Input, Event, Tag, Direct>,
  'children' | 'eventSource'
> & {
  eventSource: On
  children?:
    | CustomEventsIntrinsicChildren<Tag>
    | CustomEventsReactiveProp<Direct extends true ? Input : NoInfer<Input>, Event, RemixNode>
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
}

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

/** Default `eventSource`-omitted element on an occurrence descriptor: subscribes to every event. */
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

/** Default `eventSource`-omitted element on a remembered descriptor: subscribes to every event. */
type CustomEventsRememberedDefaultElementProps<
  Events extends EventDetails,
  State extends EventDetails,
  Tag extends keyof JSX.IntrinsicElements,
> = CustomEventsViewProps<
  CustomEventsWildcardSource<Events, State>,
  State,
  CustomEventsWildcardEvent<Events>,
  Tag,
  never,
  false
>

/** Evented-view on a remembered descriptor: `eventSource` selects sources; the input is their value(s). */
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

/** Evented-view on an occurrence source: the input is the payload, `undefined` before a match. */
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
 * The wildcard overloads infer the event map from the `eventSource` descriptor
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
      props: { readonly eventSource: Source } & (Source extends CustomEventsDescriptor<
        infer ViewEvents,
        infer ViewState
      >
        ? [ViewState] extends [never]
          ? CustomEventsDefaultElementProps<ViewEvents, Tag, true>
          : CustomEventsRememberedDefaultElementProps<ViewEvents, ViewState, Tag>
        : never),
    ): RemixNode
    <const Source extends CustomEventsWildcardSource<EventDetails>>(
      props: { readonly eventSource: Source } & (Source extends CustomEventsDescriptor<
        infer ViewEvents,
        infer ViewState
      >
        ? [ViewState] extends [never]
          ? CustomEventsDefaultElementProps<ViewEvents, Tag, false>
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
        : CustomEventsOccurrenceProps<Source, Tag, true>,
    ): RemixNode
    <const Source extends SourceSelection<EventSource<any, any, any>>>(
      props: IsRememberedEventSource<Source> extends true
        ? never
        : CustomEventsOccurrenceProps<Source, Tag, false>,
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
 * `create({ name: detail, ... }, init?)` for one or more event-named details
 * committed as a single transaction. The object form returns the matched
 * event(s): the single declared event for one key, the event union for
 * several, and a plain event for undeclared occurrence names.
 */
export type CustomEventsCreate<Events extends EventDetails> = {
  <Type extends NullDetailEventTypes<Events> & CustomEventsEventType<Events>>(
    type: Type,
    init?: CustomEventInit,
  ): CustomEventsEventMap<Events>[Type]
} & {
  <const Input extends Partial<Events> & Record<string, unknown>>(
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
export type CustomEventsBuilder<Events extends EventDetails> = {
  create: CustomEventsCreate<Events>
}

/**
 * The unified dispatch surface of a descriptor, which carries a native
 * `EventTarget` channel: dispatching a native `Event` fires it on the
 * descriptor (returning `boolean`), while an event-named input (a bare name
 * or an object of details) dispatches on the descriptor and resolves after
 * view updates and effects settle.
 */
export type CustomEventsDispatchEvent<Events extends EventDetails = EventDetails> = {
  (event: Event): boolean
  (
    input: string | (Partial<Events> & Record<string, unknown>),
    init?: CustomEventInit,
  ): Promise<void>
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
 * resolves to a callable source node, and `'*'` is the wildcard effect that
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
  }

/** How a declared effect event folds into the remembered composite. */
export type RememberedFold<Held extends EventDetails, Detail = unknown> = (
  draft: Draft<Held>,
  detail: Detail,
) => void

/**
 * The declared fold events of a remembered descriptor, keyed by event name.
 * Folds may narrow their detail parameter; the contextual type is `any` so
 * both annotated and unannotated folds assign.
 */
export type RememberedFolds<Held extends EventDetails> = {
  readonly [Name: string]: RememberedFold<Held, any>
}

/**
 * Initial details of a remembered descriptor: data values keyed by event
 * name, which cannot overwrite the descriptor API or use native DOM event
 * names.
 */
export type RememberedDetails = EventDetails & {
  readonly [Name in ReservedCustomEventsName | NativeDOMEventName]?: never
}

type RememberedFoldDetail<Folds, Name extends keyof Folds & string> = Folds[Name] extends (
  draft: any,
  detail: infer Detail,
) => any
  ? Detail
  : unknown

/** The event map of a remembered descriptor: remembered details and declared fold events. */
export type RememberedEventsMap<
  Details extends EventDetails,
  Folds extends RememberedFolds<Details>,
> = Immutable<Details> & {
  [Name in keyof Folds & string]: RememberedFoldDetail<Folds, Name>
}

/**
 * The write input of a remembered descriptor: an event-named object of details
 * (remembered keys replace their slice, fold events fold it in, undeclared
 * names fire occurrences) or a bare name for a detail-less occurrence.
 * Multi-entry transactions build a carrier with `events.create({...})` and
 * dispatch it on a native target.
 */
export type RememberedEventInput<Details extends EventDetails> =
  | string
  | (Partial<Details> & Record<string, unknown>)

/** Dispatches remembered events on the descriptor itself. */
export type RememberedDispatchEvent<Details extends EventDetails> = {
  (event: Event): boolean
  (input: RememberedEventInput<Details>, init?: CustomEventInit): Promise<void>
}

/** Runs a mounted-element effect for every descriptor event, including implicit occurrences. */
export type RememberedOnFunction = {
  <HostElement extends Element = Element>(
    listener: (
      event: CustomEvent<unknown> & { readonly type: string; readonly currentTarget: HostElement },
    ) => void | Promise<unknown>,
  ): MixinDescriptor<HostElement, any>
}

/** Remembered descriptor core: the root event, fold sub-sources, and write verbs. */
export type RememberedDescriptorBase<
  Events extends EventDetails,
  Details extends EventDetails,
> = CustomEventsBuilder<Events> & {
  dispatchEvent: CustomEventsDispatchEvent<Events> & RememberedDispatchEvent<Details>
  on: { readonly '*': RememberedOnFunction } & CustomEventsOnNamespace<Events, Immutable<Details>>
} & CustomEventsDescriptor<Events, Immutable<Details>>

/**
 * A remembered descriptor: the root composite event (`eventSource={events}`)
 * whose detail folds in every remembered detail and fold event.
 */
export type RememberedDescriptor<
  Details extends EventDetails,
  Folds extends RememberedFolds<Details>,
> = RememberedDescriptorBase<RememberedEventsMap<Details, Folds>, Details>
