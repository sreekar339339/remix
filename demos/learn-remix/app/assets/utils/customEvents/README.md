# Custom events

`customEvents` is an enhancement on top of the DOM Events API. A descriptor
is a typed `EventTarget`: everything the DOM provides works on it exactly —
`addEventListener`/`removeEventListener`, `dispatchEvent(event)` returning a
`boolean`, and `CustomEvent` instances with `type`, `detail`, `target`, and
`currentTarget`. On top of that foundation the library adds:

- **Shorthand inputs** — `dispatchEvent('name')` and
  `dispatchEvent({ name: detail, ... })` build and dispatch `CustomEvent`s
  for you; the object form commits several events atomically.
- **Typed vocabulary** — declared event names with per-event detail types,
  checked at compile time.
- **Remembered detail** — a descriptor can own a live composite detail (the
  model); dispatching an event folds a new value into it. The `root` seed
  object is updated in place, so a held reference reads the current model.
- **Addressable subscriptions** — `events.on.<name>` sources subscribe
  narrow consumers to one event and re-render exactly the affected
  addresses.
- **Element lifecycles** — Remix mixins (`on('click', ...)` for native events,
  `events.on.<source>(listener)` for element-owned effects, `asHost()` for
  hosts) wire subscriptions and effects to mounted elements.

The library is organized around these concepts:

- **Remembered descriptor** — `customEvents({ root: { ... }, folds })`: a
  declaration whose composite detail both holds its initial details (under the
  reserved `root` key) and folds in declared fold events. The descriptor
  carries native `EventTarget` listeners.
- **Occurrence descriptor** — `customEvents<Definition>()`: a typed
  vocabulary of transient events with no remembered detail.
- **Event source** — a typed, addressable subscription handle for one event.
- **Evented-view** — an intrinsic element (`evented.<tag>`) that subscribes
  to sources through the `on` host prop and re-renders from matched
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

## The DOM foundation

A descriptor is an `EventTarget`, and `create` mirrors the `CustomEvent`
constructor. The dispatch shorthand is the same DOM operation with the
constructor step elided:

| DOM                                                             | customEvents                                       |
| --------------------------------------------------------------- | -------------------------------------------------- |
| `new CustomEvent('count')`                                      | `events.create('count')`                           |
| `new CustomEvent('count', { detail: 5 })`                       | `events.create({ count: 5 })`                      |
| `target.dispatchEvent(event)` → `boolean`                       | `events.dispatchEvent(event)` → `boolean`          |
| `target.dispatchEvent(new CustomEvent('count'))`                | `events.dispatchEvent('count')` → `Promise`        |
| `target.dispatchEvent(new CustomEvent('count', { detail: 5 }))` | `events.dispatchEvent({ count: 5 })` → `Promise`   |
| `target.addEventListener('count', fn, { signal })`              | `events.addEventListener('count', fn, { signal })` |

The init dict is the DOM's `CustomEventInit` minus `detail` and `cancelable`,
plus `signal` (an already-aborted `signal` throws its abort reason at event
creation). Details are expressed by the object grammar — see
[Building events](#building-events--eventscreate).

## Public API

### Remembered descriptors — `customEvents({ root: { ... }, folds })`

A single object declares the descriptor: the reserved `root` key holds the
composite's **initial details** — data values keyed by event name — and every
other key declares a **fold event**: how an event folds into the composite, as
a mutable Immer recipe:

```ts
let events = customEvents({
  root: { count: 0, label: 'idle' },
  increment: (offset: number, root) => {
    root.count += offset
  },
})
```

The `root` key is typed by hand — its keys are user-defined, so editors cannot
suggest them — and everything else infers from it: the fold recipe's `detail`
and `root` parameters, the `on.<name>` sources, and `dispatchEvent` inputs.

The descriptor is the root composite event: `on={events}` (or the named
`events.root` source) re-reads the whole detail on every matched event. Every
detail and fold event is exposed as a typed source. The descriptor carries
native listeners, so native `addEventListener` works directly on the events
object.

The object passed as `root` is the **live composite**: dispatches fold in
place into that same object, so a reference you hold reads the current model.
That is the imperative read path — native listeners can read current values
straight from the seed — while evented-views remain the addressed read path.
Read values are readonly-typed (`Immutable`), so views and derived dispatch
inputs cannot mutate the model at compile time; writes go through dispatch.

### The mental model

A remembered descriptor is one event — the root composite — whose detail is
the entire model. The `root` key declares that event's **initial detail**: each
key inside it is simultaneously one slice of the composite and its own event
name. `events.on.count` reads the slice; dispatching `{ count: 5 }` fires a
real `count` event whose detail is `5`, folding the slice in as the new value
(the implicit "replace itself" fold).

Every other declared key is an additional event in recipe form. A fold maps an
event name to `(detail, root) => void`: the first parameter is that fold
event's own detail, and the second is the root event's detail as a mutable
Immer draft. Running the recipe mutates the draft; the resulting patches
become the fold's routing addresses.

A fold that shares a root detail's name **shadows** the detail: dispatching
the name runs the recipe instead of the implicit replace-itself fold, so the
recipe owns the update — the typical pattern for related events, where one
event's fold derives another detail from its payload. The detail's slice
remains the read surface (`events.on.<name>` reads its current value); only
the write semantics change. This is how related events express their
relationship — no separate dependency machinery is needed:

```ts
let events = customEvents({
  root: {
    celsius: '',
    fahrenheit: '',
  },
  celsius: (value: string, root) => {
    root.celsius = value
    let number = Number(value)
    if (Number.isFinite(number)) {
      root.fahrenheit = String((number * 9) / 5 + 32)
    }
  },
  fahrenheit: (value: string, root) => {
    root.fahrenheit = value
    let number = Number(value)
    if (Number.isFinite(number)) {
      root.celsius = String((number - 32) * (5 / 9))
    }
  },
})
```

Dispatching `{ celsius: '25' }` runs the celsius fold, which writes its own
slice and derives `fahrenheit`; the fold's detail types the dispatch input,
winning over the slice type. The recipe's `root` is a typed mutable Immer
draft of the composite — inferred from the data in `root` — and the fold
reads and writes the composite freely (the recipe's writes are the user's
responsibility to keep consistent).

A recipe with fewer than two parameters declares a **transient occurrence**: a
detail-carrying recipe like `(text: string) => {}`, or a detail-less recipe
like `() => {}`. An occurrence fires its event and forgets it, leaving the
composite untouched. Occurrences are typed and addressable like folds
(`events.on.<name>`, with detail `null` for detail-less ones) but never
produce patches. A fold's recipe takes exactly two parameters; default and
rest parameters are treated as folds.

Every property of the declaration is an event name, and every event name is
writable. The object form of `dispatchEvent` and `create` names declared
events — slices, folds, occurrences, and `root` — so an unknown key is a
compile error. The bare-name form (`dispatchEvent('name')`) and the native
channel (`addEventListener`, bridged targets) dispatch any name as an
occurrence.

The dispatch input may be a **function of the composite**, computed at
dispatch time: the callback receives the live composite and its return value
becomes the event-named input. Handlers never hold the model, so derived
inputs cannot go stale. The callback runs once, before any entry folds, so it
sees the pre-dispatch composite; per-name values are data:

```tsx
<input
  mix={on('input', ({ currentTarget }) => {
    events.dispatchEvent((root) => ({
      celsius: currentTarget.value,
      // The fahrenheit leg derives from the input, not from folded state.
      fahrenheit: formatTemperature((parseTemperature(root.celsius) * 9) / 5 + 32),
    }))
  })}
/>
```

A derived input works for every event kind, including the `root` write
(`dispatchEvent((root) => ({ root: { ... } }))`), and `events.create` accepts
the same callbacks for element-scoped dispatch — the input is computed when
the event is created:

```tsx
currentTarget.dispatchEvent(
  events.create((root) => ({ cellDrafted: root.formulas[id] ?? '' })),
)
```

Per-name values are plain data: a function value of an event name is
delivered as the detail itself, never invoked.

Dispatching `{ root: {...} }` is the **root event**: its detail is
the model, so it replaces the whole composite (the implicit "replace itself"
fold at the composite level) — it does not merge, and slices it omits are
gone. Use `root` for whole-model writes like hydration or reset; partial
updates use slice writes (`{ count: 5 }`) or a declared fold.

Dispatching an occurrence on a specific element keeps it local to that
element:

```tsx
<input
  mix={on('input', ({ currentTarget }) => {
    currentTarget.dispatchEvent(events.create({ drafted: currentTarget.value }))
  })}
/>
```

Only that element's own views and effects re-resolve; the composite is not
involved. This is the element-scoped dispatch pattern for per-element
transient state. Composite-changing events — slices, folds, and the `root`
write — are dispatched on the descriptor itself, so every subscribed view
stays in sync.

### Occurrence descriptors — `customEvents<Definition>()`

A typed vocabulary of transient events with no remembered detail:

```ts
const flightEvents = customEvents<'bookingConfirmed' | 'booksFound'>()
```

`root` is reserved for the remembered composite; the descriptor API names
(`create`, `on`, `asHost`, `dispatchEvent`, `addEventListener`,
`removeEventListener`), the `'*'` wildcard, and native DOM event names cannot
be events.

### Building events — `events.create`

`create` is the typed `CustomEvent` constructor. The second argument is a
`CustomEventInit`: the DOM init dict (`bubbles`, `composed`) plus `signal`,
and deliberately no `detail` or `cancelable`. A bare name builds a
detail-less event; an object of event-named details builds a single event
(one entry) or an atomic transaction carrier (several). The descriptor also
carries native `EventTarget` listeners, so consumption works directly on the
events object:

```ts
events.addEventListener('count', (event) => console.log(event.detail))
addEventListeners(events, signal, { count() {} })
element.dispatchEvent(events.create({ countDrafted: 2 })) // hosted elements
element.dispatchEvent(events.create('bookingConfirmed')) // a detail-less event
```

An already-aborted `signal` throws its abort reason when the event is
created.

`asHost()` registers an element host as a mixin; `asHost(target)` bridges the
descriptor's dispatch channel onto an external `EventTarget`:

```ts
class Drummer extends TypedEventTarget<CustomEventsEventMap<DrummerEvents>> {
  events = customEvents<DrummerEvents>().asHost(this)
}
```

### Event sources — `events.on.<name>`

Every declared event is exposed as a typed source:

```ts
events.on.count
events.on.bookingConfirmed
```

Property access records an **address**; it does not snapshot a selected value.
The source tells the runtime exactly which Immer patch paths can affect the
consumer, and the value is re-read when an event is delivered.

Nested access and collection accessors:

```ts
events.on.profile.name
events.on.columns.get(columnId).cards.get(cardId).urgent
events.on.values.A0
events.on.selected.as('green')
events.on.items[index].diameter
```

Maps and Sets retain their real key identity. Arrays are addressed by index.
A source also carries an element-owned effect listener:

```ts
events.on.<source>(listener) // MixinDescriptor; active only while mounted
```

### Evented-views — `evented.<tag>`

`evented.<tag>` is a type-only alias over the intrinsic tag: `evented.button`
is the string `'button'` at runtime. A render function's first argument is the
**detail** the `on` selects — the matched event's detail at that
source (the whole composite for the descriptor's wildcard). The matched event
is the second argument, always called `event`:

```tsx
<evented.output on={events.on.startDate}>{(detail) => detail}</evented.output>
```

Evented-view props:

| Prop             | Meaning                                                                                                                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `on`    | A source, an array of sources, or the descriptor itself. The first callback argument is the selected detail (one source), a tuple (several), or the whole composite (the descriptor); the matched event is the second. |
| `initial`        | A defined event to render before an occurrence first matches; callbacks receive it as the matched event. Remembered views need no `initial`.                                                                           |
| `children`       | Static children, or a render function of the selected detail and matched event.                                                                                                                                        |
| _reactive props_ | Any native prop may be a function of the selected detail and matched event.                                                                                                                                            |
| `mix`            | Mixins; use `events.on.<source>(...)` for element-owned effects.                                                                                                                                                       |

### Descriptor methods

| Member                                     | Signature                                                 | Purpose                                                                                        |
| ------------------------------------------ | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `dispatchEvent`                            | `dispatchEvent(event)` / `dispatchEvent(input, init?)`    | Fires a native event (boolean) or dispatches an event-named input on the descriptor (Promise). |
| `create`                                   | `create('name', init?)` / `create({ a: 1, b: 2 }, init?)` | Builds a fresh event (or transaction carrier) for any target.                                  |
| `on`                                       | `on['*'](listener)` / `on.<source>(listener)`             | The `'*'` node runs a wildcard effect; sources scope effects to one event.                     |
| `asHost`                                   | `asHost()` / `asHost(target)`                             | Element host (mixin) or domain `EventTarget` bridge.                                           |
| `addEventListener` / `removeEventListener` | native                                                    | Native listeners on the descriptor.                                                            |

Writes are dispatch-only. The object grammar dispatches an event-named set of
details atomically:

```ts
await events.dispatchEvent({ kind: 'return flight' }) // remembered: folds in
await events.dispatchEvent('bookingConfirmed') // bare name: an occurrence
await events.dispatchEvent({ kind: 'one-way flight', startDate }) // both fold in atomically
element.dispatchEvent(events.create({ countDrafted: 2 })) // hosted elements
```

`dispatchEvent(event)` returns the native `boolean`; the input form returns a
`Promise` that resolves after view updates and effects settle.

## Event maps

A detail map declares detailed events; a string union declares detail-less
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

## Remembered details

A remembered descriptor folds every dispatch into its composite detail.
Initial details hold their value until replaced; fold events mutate an Immer
draft of the composite:

```ts
let events = customEvents({ root: { count: 0 } })

await events.dispatchEvent({ count: 5 }) // replaces the count detail
await events.dispatchEvent({ root: { count: 5 } }) // replaces the whole composite
```

```ts
let events = customEvents({
  root: { columns: new Map() },
  toggleUrgency: ({ columnId, cardId }, root) => {
    let card = root.columns.get(columnId)?.cards.get(cardId)
    if (card) card.urgent = !card.urgent
  },
})
```

Fold recipes must be synchronous and return no value. A no-op fold emits
nothing but its own event. Immer patches drive the routing: keyed writes keep
per-item granularity, scalar writes route by owner identity, and deep
mutations reach exactly the affected addresses.

**Reads are views or the live seed**: subscribe `on={events}` (or the
named `events.root` source) for the whole composite or
`on={events.on.<detail>}` for one remembered value. The object passed
as `root` is the live composite — dispatches fold in place — so native
listeners (`addEventListener`) read current values straight from the seed they
created. Read values are readonly-typed (`Immutable`), so views and derived
dispatch inputs cannot mutate the model at compile time; only fold drafts and
the seed holder write. Handlers live inside a root view's render closure where
the detail is in scope; timers and async work dispatch pure events that fold
events interpret.

## Consumption patterns

### Narrow evented-views

```tsx
<evented.button on={events.on.selected.as(item.id)} aria-pressed={(selected) => selected}>
  {item.label}
</evented.button>
```

Listen to several explicit sources with an array; the selected detail becomes
a tuple index-aligned with `on`:

```tsx
<evented.button
  on={[events.on.position.get(index), events.on.result]}
  disabled={([, result]) => result !== null}
>
  {([pos]) => pos}
</evented.button>
```

### Dynamic lists

A container with a children function is a live keyed list; keyed diffs
reconcile additions, removals, and reorders with minimal DOM work while item
edits stay on item views:

```tsx
<evented.svg on={events.on.circles}>
  {(circles) =>
    [...circles.values()].map((circle) => (
      <evented.circle
        key={circle.id}
        on={[
          events.on.circles.get(circle.id).diameter,
          events.on.editingCircleById.as(circle.id),
        ]}
        r={([diameter]) => (diameter ?? circle.diameter) / 2}
      />
    ))
  }
</evented.svg>
```

Every matched event re-resolves the children function; the keyed diff applies
the change in place, and per-item elements follow their own routed sources so
edits re-render exactly the touched item.

### Whole-model wildcard view

Pass the descriptor itself to `on` to subscribe to every event; the
named `events.root` source is the same root subscription with an explicit
handle. The first argument is always the whole composite; the matched event
is the second:

```tsx
<evented.output on={events}>
  {(detail, event) =>
    event?.type === 'bookingConfirmed'
      ? `You have booked a ${detail.kind}.`
      : `${detail.kind} from ${detail.startDate}`
  }
</evented.output>
```

### Occurrence vocabulary

Occurrences are transient events with no remembered slice — any name that is
neither a detail nor a fold event. Subscribe a wildcard view to a descriptor
to see them all:

```tsx
<evented.div on={searchEvents} initial={initialEvent}>
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

`events.on` is a namespace: `events.on['*'](listener)` runs for every
descriptor event, while calling a source with a listener scopes the
effect to that source. Both create a Remix mixin that lives only while its
host element is mounted:

```tsx
<input
  mix={events.on.focusTarget.as(id)(({ currentTarget, detail }) => {
    if (detail === id) currentTarget.focus()
  })}
/>
```

There is intentionally no detached `observe()` or `subscribe()` API — detached
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
// mounted:    mix={drummer.events.on.tempoSet(listener)}
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
<evented.button on={events.on.selected.as(item.id)} aria-pressed={(selected) => selected}>
  {item.label}
</evented.button>
```

A write to a remembered scalar is addressed to the losing and gaining owners
by value; untouched siblings do not re-render. An `.as(id)` view receives the
boolean whether the scalar currently equals `id`; an `.as(id)` effect receives
the scalar value in `event.detail`.

## Differences from DOM

The DOM foundation is exact; the enhancement layer deliberately deviates
where DOM semantics do not apply:

- **No cancelable events.** Custom events describe completed facts, so
  `cancelable`/`preventDefault` are rejected at runtime and the init type
  omits them.
- **No `detail` in the init dict.** DOM's `CustomEventInit` carries `detail`;
  here details live in the object grammar (`create({ name: detail })`), so a
  bare name always builds a detail-less event.
- **`bubbles` defaults to `true`.** The DOM defaults to `false`; here the
  default lets a descriptor dispatch reach every subscription in its default
  host scope.
- **Logical routing, not DOM-tree propagation.** Dispatched events do not
  travel the document tree; the runtime routes them by event type, address
  path (Immer patches), and host scope to subscribed views and effects.
- **Shorthand dispatch settles asynchronously.** The input form of
  `dispatchEvent` returns a `Promise` that resolves after matching views
  re-render and effects settle; a native `Event` argument still returns the
  DOM's synchronous `boolean`.
- **Descriptor isolation.** Events created by one descriptor are ignored by
  every other descriptor, even under the same raw name.
- **Live composite detail.** A remembered descriptor's composite detail is
  current and readable through sources; a DOM `CustomEvent.detail` is a
  one-shot snapshot. Reads are guarded by readonly types, not runtime
  freezing: the seed object stays the mutable live model.

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
