import type { GenericJSXComponent, MixinDescriptor, Props, RemixNode } from 'remix/ui'
import type { EventSource, EventSources } from './eventSources.ts'

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

export type ReservedCustomEventsName = 'create' | 'dispatch' | 'on' | 'asHost' | 'view' | 'store'
type ReservedNamesIn<Definition> = Extract<EventNames<Definition>, ReservedCustomEventsName>

type NativeEventNameError<Names extends string> = {
  readonly __customEventsNativeEventNameError: 'customEvents names cannot overlap native DOM event names.'
  readonly nativeEventNames: Names
}

export type CustomEventsFactoryArgs<Definition> = [NativeNamesIn<Definition>] extends [never]
  ? [ReservedNamesIn<Definition>] extends [never]
    ? [options?: CustomEventsOptions]
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
export type CustomEventsInit = Omit<EventInit, 'cancelable'> & {
  /** Custom events describe completed facts and are never cancelable. */
  cancelable?: never
  /** Throws the signal's abort reason when it is already aborted. */
  signal?: AbortSignal
}

export type CustomEventsOptions = {
  /** Immediately registers a domain `EventTarget` as the default host. */
  host?: EventTarget
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

type CustomEventsReactiveProp<Input, Value> = (input: Input) => Value

type CustomEventsReactiveElementProps<Input, Tag extends keyof JSX.IntrinsicElements> = {
  [Key in keyof Props<Tag>]: Key extends string
    ? Key extends 'children' | 'key' | 'mix' | 'ref' | 'on' | `on${string}`
      ? Props<Tag>[Key]
      : Props<Tag>[Key] | CustomEventsReactiveProp<NoInfer<Input>, Props<Tag>[Key]>
    : Props<Tag>[Key]
} & {
  [Key in `data-${string}`]?:
    | string
    | undefined
    | CustomEventsReactiveProp<NoInfer<Input>, string | undefined>
}

type CustomEventsIntrinsicChildren<Tag extends keyof JSX.IntrinsicElements> =
  Props<Tag> extends { children?: infer Children } ? Children : RemixNode

/** Props for an intrinsic element driven by one descriptor event. */
type CustomEventsElementProps<On, Input, Tag extends keyof JSX.IntrinsicElements> = Omit<
  CustomEventsReactiveElementProps<Input, Tag>,
  'children'
> & {
  on: On
  children?:
    | CustomEventsIntrinsicChildren<Tag>
    | CustomEventsReactiveProp<NoInfer<Input>, RemixNode>
}

type CustomEventsInputProps<
  On,
  Input,
  Tag extends keyof JSX.IntrinsicElements,
  Initialized extends boolean,
> = CustomEventsElementProps<On, Input | (Initialized extends true ? never : undefined), Tag> &
  (Initialized extends true ? { initial: Input } : { initial?: never })

type SourceSelection<Source> = Source | readonly Source[]

type CustomEventsSourceItem<Events extends EventDetails> = EventSource<
  any,
  keyof Events & string,
  any
>

type CustomEventsSourceEvent<Source> = Source extends readonly (infer Item)[]
  ? CustomEventsSourceEvent<Item>
  : Source extends EventSource<infer Value, infer Type, any>
    ? CustomEvent<Value> & { readonly type: Type }
    : never

type CustomEventsDefaultElementProps<
  Events extends EventDetails,
  Tag extends keyof JSX.IntrinsicElements,
  Initialized extends boolean,
> = Omit<
  CustomEventsInputProps<
    '*',
    CustomEventsEventMap<Events>[CustomEventsEventType<Events>],
    Tag,
    Initialized
  >,
  'on'
> & { on?: never }

/** The value selected by a source: its payload for occurrences, its path value for state. */
type CustomEventsSourceValue<Source> =
  Source extends EventSource<infer Value, any, any> ? Value : never

/**
 * The detail delivered to a state view. One source yields the selected value;
 * several sources yield a tuple index-aligned with `on`.
 */
type CustomEventsSourceDetail<Source> = Source extends readonly unknown[]
  ? { [Index in keyof Source]: CustomEventsSourceValue<Source[Index]> }
  : CustomEventsSourceValue<Source>

/** Payloads of the occurrence events not retained by the store. */
type CustomEventsOccurrenceDetail<Events extends EventDetails, State extends EventDetails> = {
  [Key in CustomEventsEventType<Events>]: Key extends keyof State & string ? never : Events[Key]
}[CustomEventsEventType<Events>]

/** Detail for an `on`-omitted state view: the whole snapshot or one occurrence payload. */
type CustomEventsStateViewInput<Events extends EventDetails, State extends EventDetails> = {
  detail: State | CustomEventsOccurrenceDetail<Events, State>
}

/** Evented-view on a state store: `on` selects sources; the detail is their value(s). */
type CustomEventsStateElementProps<
  Events extends EventDetails,
  State extends EventDetails,
  Tag extends keyof JSX.IntrinsicElements,
  Source,
> = Omit<
  CustomEventsReactiveElementProps<{ detail: CustomEventsSourceDetail<Source> }, Tag>,
  'children' | 'on'
> & {
  on: Source
  initial?: never
  children?:
    | CustomEventsIntrinsicChildren<Tag>
    | CustomEventsReactiveProp<NoInfer<{ detail: CustomEventsSourceDetail<Source> }>, RemixNode>
}

/** Default `on`-omitted element for a state store: subscribes to every event. */
type CustomEventsStateDefaultElementProps<
  Events extends EventDetails,
  State extends EventDetails,
  Tag extends keyof JSX.IntrinsicElements,
> = Omit<
  CustomEventsReactiveElementProps<CustomEventsStateViewInput<Events, State>, Tag>,
  'children' | 'on'
> & {
  on?: never
  children?:
    | CustomEventsIntrinsicChildren<Tag>
    | CustomEventsReactiveProp<NoInfer<CustomEventsStateViewInput<Events, State>>, RemixNode>
}

type CustomEventsOccurrenceProps<
  Source,
  Tag extends keyof JSX.IntrinsicElements,
  Initialized extends boolean,
> = CustomEventsElementProps<
  Source,
  CustomEventsSourceEvent<Source> | (Initialized extends true ? never : undefined),
  Tag
> &
  (Initialized extends true ? { initial: CustomEventsSourceEvent<Source> } : { initial?: never })

/** Event-aware intrinsic element that re-renders from matched events. */
export type CustomEventsEventedView<
  Events extends EventDetails,
  State extends EventDetails | never,
  Tag extends keyof JSX.IntrinsicElements,
> = GenericJSXComponent & {
  (
    props: [State] extends [never]
      ? CustomEventsDefaultElementProps<Events, Tag, true>
      : CustomEventsStateDefaultElementProps<Events, State, Tag>,
  ): RemixNode
  (
    props: [State] extends [never]
      ? CustomEventsDefaultElementProps<Events, Tag, false>
      : CustomEventsStateDefaultElementProps<Events, State, Tag>,
  ): RemixNode
  <const Source extends SourceSelection<CustomEventsSourceItem<Events>>>(
    props: [State] extends [never]
      ? CustomEventsOccurrenceProps<Source, Tag, true>
      : CustomEventsStateElementProps<Events, State, Tag, Source>,
  ): RemixNode
  <const Source extends SourceSelection<CustomEventsSourceItem<Events>>>(
    props: [State] extends [never]
      ? CustomEventsOccurrenceProps<Source, Tag, false>
      : CustomEventsStateElementProps<Events, State, Tag, Source>,
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

/** Per-entry routing; propagation belongs to the shared batch carrier. */
type CustomEventsBatchEntryConfiguration<Detail> = [Detail] extends [null]
  ? { detail?: null }
  : { detail: Detail }

/** One entry in a shared event transaction. */
export type CustomEventsBatchEntry<Events extends EventDetails> = {
  [Type in keyof Events & string]: Record<Type, CustomEventsBatchEntryConfiguration<Events[Type]>>
}[keyof Events & string]

/** A detail-less event-name shorthand or a configured transaction entry. */
export type CustomEventsBatchItem<Events extends EventDetails> =
  | NullDetailEventTypes<Events>
  | CustomEventsBatchEntry<Events>

type NonEmptyArray<Value> = readonly [Value, ...Value[]]

type CustomEventsResult<
  Events extends EventDetails,
  Type extends CustomEventsEventType<Events>,
  Async extends boolean,
> = Async extends true ? Promise<void> : CustomEventsEventMap<Events>[Type]

/** Call grammar for one event: detail-less, or with a typed payload. */
type CustomEventsSingleOperation<
  Events extends EventDetails,
  Prefix extends unknown[],
  Async extends boolean,
> = {
  <Type extends NullDetailEventTypes<Events> & CustomEventsEventType<Events>>(
    ...args: [...Prefix, type: Type, init?: CustomEventsInit]
  ): CustomEventsResult<Events, Type, Async>

  <Type extends keyof Events & string & CustomEventsEventType<Events>>(
    ...args: [...Prefix, type: Type, detail: Events[Type], init?: CustomEventsInit]
  ): CustomEventsResult<Events, Type, Async>
}

/** Call grammar for an ordered transaction: one shared carrier and commit. */
type CustomEventsBatchOperation<
  Events extends EventDetails,
  Prefix extends unknown[],
  Async extends boolean,
> = {
  <const Entries extends NonEmptyArray<CustomEventsBatchItem<Events>>>(
    ...args: [...Prefix, entries: Entries, init?: CustomEventsInit]
  ): CustomEventsResult<Events, never, Async>
}

export type CustomEventsFactory<Events extends EventDetails> = CustomEventsSingleOperation<
  Events,
  [],
  false
>

export type CustomEventsDispatch<Events extends EventDetails> = CustomEventsSingleOperation<
  Events,
  [target: EventTarget],
  true
> &
  CustomEventsBatchOperation<Events, [target: EventTarget], true>

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

export type CustomEventsDescriptor<
  Events extends EventDetails,
  State extends EventDetails | never = never,
> = EventSources<Events, State> & {
  /** Creates one fresh event. */
  create: CustomEventsFactory<Events>
  /** Dispatches and resolves after view updates and effects settle. */
  dispatch: CustomEventsDispatch<Events>
  /** Runs a mounted-element effect for every descriptor event. */
  on: CustomEventsOnFunction<Events>
  /** Makes an element act as a host for this descriptor. */
  asHost: MixinDescriptor<Element, any>
  /** Event-aware intrinsic elements for this descriptor. */
  view: CustomEventsEventedViews<Events, State>
}
