# Custom events

`customEvents` combines native `CustomEvent`/`EventTarget`, Immer-backed model
folds, addressable event sources, and Remix element lifecycles. It exists to
update an existing DOM view at the narrowest affected model address without
splitting every repeated element into a component with its own state and
`handle.update()` ceremony.

The library is organized around these concepts:

- **Remembered descriptor** — `customEvents(seeds, folds)`: an event
  declaration whose root event's detail folds in every remembered seed and
  fold event. The descriptor is itself an `EventTarget`.
- **Occurrence descriptor** — `customEvents<Definition>()`: a typed
  vocabulary of transient events with no remembered model.
- **Event source** — a typed, addressable subscription handle for one event.
- **Evented-view** — an intrinsic element (`evented.<tag>`) that subscribes
  to sources through the `eventSource` host prop and re-renders from matched
  events.
- **Effect** — an element-owned listener run after views update.
- **Subscription** — the runtime registration that routes events to an
  evented-view or effect.

The vocabulary reuses standard web/CS terms: _subscribe_, _subscription_,
_render_, _effect_, _source_, _host_, _routing_, and _transaction_.

`events` is only an event-source graph. `evented` is only an intrinsic-element
namespace, shared by every descriptor. Keeping these namespaces separate means
domain events may safely be named `output`, `form`, `name`, `length`, or any
other intrinsic/function name.

## Public API

### Remembered descriptors — `customEvents(seeds, folds)`

The first argument is the model's **initial details**: data values keyed by
event name. The second maps **fold events** — how an event folds into the
model — as mutable Immer recipes:

```ts
let events = customEvents(
  { count: 0, label: 'idle' },
  {
    increment: (draft, offset: number) => {
      draft.count += offset
    },
  },
)
```

The descriptor is the root composite event: `eventSource={events}` re-reads
the whole detail on every matched event. Every seed and fold event is exposed
as a typed source. The descriptor is an `EventTarget`, so it also carries
native listeners.

### Occurrence descriptors — `customEvents<Definition>()`

A typed vocabulary of transient events with no remembered model:

```ts
const flightEvents = customEvents<'bookingConfirmed' | 'booksFound'>()
```

Reserved names cannot be events: `create`, `on`, `asHost`, `dispatchEvent`,
`addEventListener`, `removeEventListener`, and native DOM event names.

### The descriptor is an `EventTarget`

Descriptors are real `EventTarget`s. Native consumption works directly on the
events object:

```ts
events.addEventListener('count', (event) => console.log(event.detail))
addEventListeners(events, signal, { count() {} })
```

`asHost()` registers an element host as a mixin; `asHost(target)` bridges the
descriptor's dispatch channel onto an external `EventTarget`:

```ts
class Drummer extends TypedEventTarget<CustomEventsEventMap<DrummerEvents>> {
  events = customEvents<DrummerEvents>().asHost(this)
}
```

### Event sources — `events.<name>`

Every declared event is exposed as a typed source:

```ts
events.count
events.bookingConfirmed
```

Property access records an **address**; it does not snapshot a selected value.
The source tells the runtime exactly which Immer patch paths can affect the
consumer, and the value is re-read when an event is delivered.

Nested access and collection accessors:

```ts
events.profile.name
events.columns.get(columnId).cards.get(cardId).urgent
events.values.A0
events.selected.as('green')
events.items[index].diameter
```

Maps and Sets retain their real key identity. Arrays are addressed by index.
A source also carries an element-owned effect listener:

```ts
source.on(listener) // MixinDescriptor; active only while mounted
```

### Evented-views — `evented.<tag>`

`evented.<tag>` is a type-only alias over the intrinsic tag: `evented.button`
is the string `'button'` at runtime. A render function's first argument is the
**detail** the `eventSource` selects — the matched event's detail at that
source (the whole composite for the descriptor's wildcard). The matched event
is the second argument, always called `event`:

```tsx
<evented.output eventSource={events.startDate}>{(detail) => detail}</evented.output>
```

Evented-view props:

| Prop             | Meaning                                                                                                                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `eventSource`    | A source, an array of sources, or the descriptor itself. The first callback argument is the selected detail (one source), a tuple (several), or the whole composite (the descriptor); the matched event is the second. |
| `initial`        | A defined event to render before an occurrence first matches; callbacks receive it as the matched event. Remembered views need no `initial`.                                                                           |
| `children`       | Static children, or a render function of the selected detail and matched event.                                                                                                                                        |
| _reactive props_ | Any native prop may be a function of the selected detail and matched event.                                                                                                                                            |
| `mix`            | Mixins; use `source.on(...)` for element-owned effects.                                                                                                                                                                |

### Descriptor methods

| Member                                     | Signature                                                                     | Purpose                                                                                        |
| ------------------------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `dispatchEvent`                            | `dispatchEvent(event)` / `dispatchEvent(input, init?)`                        | Fires a native event (boolean) or dispatches an event-named input on the descriptor (Promise). |
| `create`                                   | `create(type, detail?, init?)` / `create({ name: detail })` / `create([...])` | Builds a fresh event for any target.                                                           |
| `on`                                       | `on(listener)`                                                                | Element-owned wildcard effect for every descriptor event.                                      |
| `asHost`                                   | `asHost()` / `asHost(target)`                                                 | Element host (mixin) or domain `EventTarget` bridge.                                           |
| `addEventListener` / `removeEventListener` | native                                                                        | Native listeners on the descriptor.                                                            |

Writes are dispatch-only. The object grammar dispatches an event-named set of
details atomically:

```ts
await events.dispatchEvent({ kind: 'return flight' }) // remembered: folds in
await events.dispatchEvent('bookingConfirmed') // bare name: an occurrence
await events.dispatchEvent([{ startDate }, { returnDate }]) // via create + a native target
element.dispatchEvent(events.create('countDrafted', 2)) // hosted elements
```

`dispatchEvent(event)` returns the native `boolean`; the input form returns a
`Promise` that resolves after view updates and effects settle.

## Event maps

A payload map declares detailed events; a string union declares detail-less
occurrences:

```ts
type Flight = {
  kind: 'one-way flight' | 'return flight'
  startDate: string
  returnDate: string
}

type FlightEvents = Flight | 'bookingConfirmed'

const flightEvents = customEvents<FlightEvents>()
```

Native DOM event names are rejected. Custom events describe completed facts,
so they are deliberately non-cancelable.

## Remembered state

A remembered descriptor folds every dispatch into its detail. Remembered
seeds hold their value; fold events mutate an Immer draft of the composite:

```ts
let events = customEvents({ count: 0 })

await events.dispatchEvent({ count: 5 }) // the count fold: replace itself
```

```ts
let events = customEvents(
  { columns: new Map() },
  {
    toggleUrgency: (draft, { columnId, cardId }) => {
      let card = draft.columns.get(columnId)?.cards.get(cardId)
      if (card) card.urgent = !card.urgent
    },
  },
)
```

Fold recipes must be synchronous and return no value. A no-op fold emits
nothing but its own event. Immer patches drive the routing: Map item replaces
keep keyed granularity, scalar writes route by owner identity, and deep
mutations reach exactly the affected addresses.

**Reads are views only**: subscribe `eventSource={events}` for the whole
composite or `eventSource={events.<seed>}` for one remembered value. Handlers
live inside a root view's render closure where the detail is in scope; timers
and async work dispatch pure events that fold events interpret.

## Consumption patterns

### Narrow evented-views

```tsx
<evented.button eventSource={events.selected.as(item.id)} aria-pressed={(selected) => selected}>
  {item.label}
</evented.button>
```

Listen to several explicit sources with an array; the selected detail becomes
a tuple index-aligned with `eventSource`:

```tsx
<evented.button
  eventSource={[events.position.get(index), events.result]}
  disabled={([, result]) => result !== null}
>
  {([pos]) => pos}
</evented.button>
```

### Dynamic lists

A container with a children function is a live keyed list; keyed diffs
reconcile additions, removals, and reorders while item edits stay on item
views:

```tsx
<evented.svg eventSource={events.circles}>
  {(circles) =>
    [...circles.values()].map((circle) => (
      <evented.circle
        key={circle.id}
        eventSource={[
          events.circles.get(circle.id).diameter,
          events.editingCircleById.as(circle.id),
        ]}
        r={([diameter]) => (diameter ?? circle.diameter) / 2}
      />
    ))
  }
</evented.svg>
```

For large collections use the keyed `evented.list` intrinsic with a per-item
template; per-item elements follow their own keyed routes so whole collections
skip re-resolving on item edits.

### Whole-model wildcard view

Pass the descriptor itself to `eventSource` to subscribe to every event. The
first argument is always the whole composite; the matched event is the second:

```tsx
<evented.output eventSource={events}>
  {(detail, event) =>
    event?.type === 'bookingConfirmed'
      ? `You have booked a ${detail.kind}.`
      : `${detail.kind} from ${detail.startDate}`
  }
</evented.output>
```

### Occurrence vocabulary

Occurrences are transient events with no remembered slice — any name that is
neither a seed nor a fold event. Subscribe a wildcard view to a descriptor to
see them all:

```tsx
<evented.div eventSource={searchEvents} initial={initialEvent}>
  {(_, event) => {
    switch (event.type) {
      case 'queryEmpty':
        return 'Enter a title'
      case 'querySubmitted':
        return `Searching for ${event.detail.query}`
      case 'booksFound':
        return `${event.detail.length} books`
    }
  }}
</evented.div>
```

When the render switches on `event.type`, prefer the event's typed
`event.detail` over the first argument; the first argument is the value of the
source, not the matched occurrence.

### Element-owned effects

A source's `.on(listener)` creates a Remix mixin that lives only while its
host element is mounted:

```tsx
<input
  mix={events.focusTarget.as(id).on(({ currentTarget, detail }) => {
    if (detail === id) currentTarget.focus()
  })}
/>
```

The descriptor's root `.on(listener)` runs for every descriptor event. There
is intentionally no detached `observe()` or `subscribe()` API — detached
consumers use the descriptor's own `EventTarget` channel
(`addEventListener` / `addEventListeners`).

### Hosting

`events.asHost()` registers an element as a local routing host:

```tsx
<section mix={events.asHost()}>...</section>
```

`events.asHost(target)` bridges the descriptor onto an external `EventTarget`
so the domain object's native listeners fire:

```ts
class Drummer extends TypedEventTarget<CustomEventsEventMap<DrummerEvents>> {
  events = customEvents<DrummerEvents>().asHost(this)
}

// detached:   addEventListeners(drummer, signal, { tempoSet() {} })
// mounted:    mix={drummer.events.tempoSet.on(...)}
// write:      drummer.events.dispatchEvent({ tempoSet: 120 })
```

Events created by one descriptor are ignored by another descriptor even when
their raw names match. Dispatch scope follows the origin target: element-hosted
dispatch keeps events local, while dispatching on a descriptor (or its bridged
domain target) broadcasts to the default host scope.

### Scalar identity routing

Identity-valued details (which row is selected, which cell is focused) route
by value via `.as(ownerId)`:

```tsx
<evented.button eventSource={events.selected.as(item.id)} aria-pressed={(selected) => selected}>
  {item.label}
</evented.button>
```

A write to a remembered scalar is addressed to the losing and gaining owners
by value; untouched siblings do not re-render. An `.as(id)` view receives the
boolean whether the scalar currently equals `id`; an `.as(id)` effect receives
the scalar value in `event.detail`.

## Sequencing

One processed event transaction follows this order:

1. Re-render matching views on the event's origin element.
2. Re-render the remaining matching views.
3. Run matching `.on(...)` effects.
4. Resolve the awaited `dispatchEvent(...)` after returned promises settle.

## Design guidance

- Name events as facts that have already happened, usually past-tense domain
  language: `querySubmitted`, `booksFound`, `actionErrored`.
- Remember an event when consumers need its current readable value; use an
  occurrence when repetition matters and there is no meaningful current value.
- Prefer a deep source over broad component invalidation when one existing DOM
  view owns that address; prefer one wildcard mounted effect when the component
  genuinely renders as a cohesive unit.
- Fold events read the composite through their draft; never hold a stale
  closure over model values.
- Reaching for a whole-model wildcard view is a signal the component renders
  as a unit; narrow evented-views earn their keep when only a few addresses
  change per event.
