# Custom events

`customEvents` combines native `CustomEvent`/`EventTarget`, Immer-backed model
updates, addressable event sources, and Remix element lifecycles. It exists to
update an existing DOM view at the narrowest affected model address without
splitting every repeated element into a component with its own state and
`handle.update()` ceremony.

The library is organized around five concepts:

- **Store** — an `EventTarget` retaining immutable state mutated through Immer
  recipes; `state.value` reads the current snapshot.
- **Event source** — a typed, addressable subscription handle for one event.
- **Evented-view** — an intrinsic element (`view.<tag>`) that subscribes
  to sources and re-renders from matched events.
- **Effect** — an element-owned listener run after views update.
- **Subscription** — the runtime registration that routes events to an
  evented-view or effect.

The vocabulary reuses standard web/CS terms: _subscribe_, _subscription_,
_render_, _effect_, _source_, _host_, _routing_, and _transaction_.

`events` is only an event-source graph. `view` is only an intrinsic-element
factory. Keeping these namespaces separate means domain events may safely be
named `output`, `form`, `name`, `length`, or any other intrinsic/function name.

## Public API

### `customEvents<Definition>(options?)`

Creates an event descriptor. `Definition` declares the event vocabulary as
either a payload map or a detail-less string union (see
[Event maps](#event-maps)).

```ts
const flightEvents = customEvents<FlightEvents>()
```

Options:

```ts
{ host?: EventTarget }  // registers a domain EventTarget as the default host
```

The descriptor is itself the source graph. The reserved names `create`,
`dispatch`, `on`, `asHost`, `view`, and `store` cannot be event names. Native
DOM event names are likewise rejected. Store state keys live under
`state.value`, so they only need to avoid those event-name collisions.

### Event sources — `events.<name>`

Every declared event is exposed as a typed source:

```ts
flightEvents.kind
flightEvents.bookingConfirmed
```

On a store the sources live under the descriptor:

```ts
store.events.kind
store.events.bookingConfirmed
```

Property access records an **address**; it does not snapshot a selected value.
Each access reads the current value at that address only to classify
collections (Map, Set, array, object) and choose the right accessor shape. The
source tells the runtime exactly which Immer patch paths can affect the
consumer, and the value is re-read when an event is delivered. The event
delivered to callbacks contains the current value at that address as
`event.detail`.

Nested access and collection accessors:

```ts
store.events.profile.name
board.events.columns.get(columnId).cards.get(cardId).urgent
sheet.events.values.A0
selection.events.selected.as('green')
circles.events.items[index].diameter
```

Maps and Sets retain their real key identity. Arrays are addressed by index:
an item is reached by the index written and read, never by an `id` property.
That index behaves as a key like any other and stays stable as neighbors are
added or removed.

A source also carries an element-owned effect listener:

```ts
source.on(listener) // MixinDescriptor; active only while mounted
```

### Evented-views — `view.<tag>`

`view.<tag>` creates an intrinsic element that subscribes to sources and
re-renders from matched events. The `detail` delivered to the render function
is the **value the `on` source selects**: the current value at that source's
path for one source, a tuple index-aligned with `on` for several, and the whole
state snapshot when `on` is omitted (the implicit root path).

```tsx
<view.output on={events.startDate}>{({ detail }) => detail}</view.output>
```

Occurrence events (declared but not retained by a store) fill their tuple
slot with the occurrence payload when that occurrence triggered the render and
`undefined` otherwise.

Evented-view props:

| Prop             | Meaning                                                                                                                                            |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `on`             | A source, or an array of sources, this view subscribes to. The `detail` is the selected value (one source) or a tuple aligned with `on` (several). |
| `initial`        | A defined event to render before an occurrence first matches. Store views need no `initial`.                                                       |
| `children`       | Static children, or a render function of the matched event.                                                                                        |
| _reactive props_ | Any native prop may be a function of the matched event.                                                                                            |
| `mix`            | Mixins; use `source.on(...)` for element-owned effects.                                                                                            |

### Descriptor methods

| Member     | Signature                      | Purpose                                                        |
| ---------- | ------------------------------ | -------------------------------------------------------------- |
| `create`   | `create(type, detail?, init?)` | Creates a fresh event `CustomEvent`.                           |
| `dispatch` | `dispatch(target, ...)`        | Dispatches and resolves after view updates and effects settle. |
| `on`       | `on(listener)`                 | Element-owned wildcard effect for every descriptor event.      |
| `asHost`   | `asHost`                       | Makes an element act as a host for this descriptor.            |
| `view`     | `view.<tag>`                   | Evented-view factory.                                          |
| `store`    | `store(value)`                 | Creates a store (see below).                                   |

### Store

One `.store(value)` creates every store. Called on a bare descriptor
(`customEvents().store(value)`) it infers the whole store from the value's
keys. Called on a declared descriptor (`customEvents<Def>().store(value)`) the
value's keys become held events the store remembers, declared entries omitted
from the value remain unheld occurrences, and declared entries override the
value's literal type (widening initial `null` or `[]` entries).

Every store creates an independent `EventTarget` and retains the initial
properties as immutable state. The instance exposes **no state properties**;
state lives under a `state` namespace that owns the snapshot and its updates.

Destructure the store in the setup scope — `view`, `events`, `state`, and
`host` are all stable references, so destructuring snapshots none of them:

```ts
let { view, events, state, host } = customEvents<FlightEvents>().store({
  kind: 'one-way flight',
  startDate: '2026-08-02',
  returnDate: '2026-08-02',
})

state.value.kind // "one-way flight"
host.dispatchEvent(events.create('bookingConfirmed'))
```

The store is a plain holder, not itself an `EventTarget`: ordinary consumption
goes through the `host` namespace. Pass the full store when consumers
need the whole object (context):

```ts
let appContext = appContextEvents.store({ ... });
handle.context.set(appContext);
```

`state` is the state namespace: `state.value` is a live read of the current
snapshot (a `value` accessor forwards to the latest `state` on every access), and
`state.update(recipe)` mutates it. A destructured `state` reflects later
updates — read `state.value` inside the render closure for live values.

| Member                 | Purpose                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------- |
| `state.value`          | The current immutable snapshot (`Immutable<State>`); a live read.                                       |
| `state.update(recipe)` | Mutates state through an Immer draft and dispatches change events. Read current state from the `draft`. |
| `events`               | The descriptor: sources and descriptor methods.                                                         |
| `view`                 | The evented-view factory.                                                                               |
| `host`                 | The store's `EventTarget`: ordinary `addEventListener` / `dispatchEvent` consumption of state events.   |

## Event maps

A payload map declares detailed events. A string union declares detail-less
events:

```ts
type Flight = {
  kind: 'one-way flight' | 'return flight'
  startDate: string
  returnDate: string
}

type FlightEvents = Flight | 'bookingConfirmed'

const flightEvents = customEvents<FlightEvents>()
```

This is an algebraic domain vocabulary:

- object properties form a product of simultaneously readable held events;
- a string union adds alternative occurrences;
- `.store()` chooses which declared entries the store holds;
- declared entries omitted from the `.store()` value remain occurrences.

Native DOM event names are rejected. Custom events describe completed facts,
so they are deliberately non-cancelable.

## Evented state

A `.store()` call retains the supplied value as immutable state. Mutate it with
normal mutable JavaScript expressions through `state.update()`:

```ts
state.update((draft) => {
  draft.kind = 'return flight'
})
```

Immer preserves the published model as immutable data and produces patches for
deep mutations. No object spreading, array copying, or replacement `Map` is
needed:

```ts
state.update((draft) => {
  draft.columns.get(columnId)!.cards.get(cardId)!.urgent = true
})
```

An update recipe must be synchronous and return no value. A no-op recipe emits
nothing. Every changed top-level state property is also dispatched as a native
custom event on the store's `host`, so ordinary `addEventListener()` and
Remix `addEventListeners()` consumers remain available.

Read current state inside a recipe when the read must be atomic with the write
(a single top-level event, one view re-render):

```ts
state.update((draft) => {
  let circle = draft.circles.get(draft.editingCircleById!)
  if (!circle) return
  circle.diameter = newDiameter
})
```

Read `state.value` at render time when the owning component needs current state
to build structure (a list, a component subtree). A destructured `state` reads
the same live snapshot. A source's `.on()` effect listener still receives the
scoped value at its address, not the snapshot.

### Context typing

Keep one descriptor as the type anchor and derive the store type from its
`store` method:

```ts
export const appContextEvents = customEvents<AppContextValue>()

export type AppContext = ReturnType<typeof appContextEvents.store<AppContextValue>>
```

The same descriptor can create each provider's independent store.

## Consumption patterns

### Narrow evented-views

Use `view.<intrinsic>` and pass a source to `on`. Children and native
properties may be functions of the matched event; on a store the event's
`detail` is the value that source's path selects:

```tsx
<view.button
  on={events.selected.as(item.id)}
  aria-pressed={({ detail }) => detail}
  class={({ detail }) => (detail ? 'selected' : '')}
>
  {item.label}
</view.button>
```

This is especially useful inside lists. The component remains one readable,
HTML-shaped tree while each existing row, card, circle, or cell updates only
its affected native attributes and children.

Listen to several explicit sources with an array; `detail` becomes a tuple
index-aligned with `on`. Destructure it with names in the callback for
readable multi-source views:

```tsx
<view.button
  on={[events.position.get(index), events.result]}
  disabled={({ detail: [, result] }) => result !== null}
>
  {({ detail: [pos] }) => pos}
</view.button>
```

Elide tuple positions the callback does not read (`[, result]`). An evented-view
accepts one source per event type; passing two sources that share a type
throws.

### Whole-model default source

On a store, omitting `on` subscribes the view to every event. It
re-reads the whole state snapshot on mount and re-renders whenever any state
property changes. Occurrence events still arrive raw. The render function's
`detail` is the state snapshot on state events and the occurrence payload
otherwise:

```tsx
<view.output>
  {({ detail }) =>
    typeof detail === 'object' ? `${detail.kind} from ${detail.startDate}` : detail
  }
</view.output>
```

The snapshot read needs no `initial` because a snapshot always exists. This
makes the evented-view a live read-only view of the whole store — ideal for an
element whose output depends on several properties at once, such as a progress
bar ratio.

### Occurrence vocabulary

A descriptor with no state broadcasts occurrences. Omitting `on` subscribes the
view to every descriptor event:

```tsx
<searchEvents.view.div initial={initialEvent}>
  {(event) => {
    switch (event.type) {
      case 'queryEmpty':
        return 'Enter a title'
      case 'querySubmitted':
        return `Searching for ${event.detail.query}`
      case 'booksFound':
        return `${event.detail.length} books`
    }
  }}
</searchEvents.view.div>
```

Before an occurrence first matches, its callback input is `undefined`. Supply
`initial={events.create(...)}` when a defined initial occurrence is part of the
UI model.

### Element-owned effects

An event source's `.on(listener)` creates a Remix mixin. The listener exists
only while its host element is mounted:

```tsx
<input
  mix={sheet.events.focusTarget.as(id).on(({ currentTarget, detail }) => {
    if (detail === id) currentTarget.focus()
  })}
/>
```

The source address participates in the same keyed/deep routing as a view.
`currentTarget` is the mounted element owning the mixin.

Use the descriptor's root `.on(listener)` for every descriptor event:

```tsx
<section mix={events.on(() => handle.update())}>{/* component-wide render */}</section>
```

This centralizes component invalidation: DOM handlers only mutate the store,
and one mounted effect calls `handle.update()`. Place it on the element that
naturally owns the render; it does not need to be the component root.

There is intentionally no detached `observe()` or `subscribe()` API:

- UI effects should have a mounted element lifecycle and use a mixin.
- Detached domain consumers should use native `addEventListener()` or Remix
  `addEventListeners(target, signal, listeners)`.

This avoids a second registration, cleanup, target, wildcard, and sequencing
model.

## Occurrences and creation

Create occurrences explicitly:

```ts
form.dispatchEvent(events.create('bookingConfirmed'))
form.dispatchEvent(events.create('searchSucceeded', results))
```

`create()` always returns a fresh native `CustomEvent`. Detail-less events have
`detail === null`; `null` is an intentional DOM-compatible value rather than an
absent JavaScript argument.

Dispatch events, read state: state is the part of the event stream the store
remembers. Every declared event name is an event — held names included. Creating
a held name folds its value into the snapshot (readable at `state.value`) and
still emits the event:

```ts
host.dispatchEvent(events.create('returnDate', '2026-08-09'))
state.value.returnDate // "2026-08-09"
```

Held folds route at the root, re-rendering every subscriber to that event;
`state.update()` keeps its deep Immer patch routing for targeted mutations.

An already-aborted signal throws before event creation:

```ts
events.create('saved', detail, { signal })
```

Use `dispatch()` when completion must be awaited:

```ts
await events.dispatch(form, 'saved', detail)
```

It resolves after matching views re-render and their effects settle.

## Transactions

An ordered array creates one logical event transaction:

```ts
await events.dispatch(target, [
  'gameStateChanged',
  {
    cellFocusRequested: {},
  },
])
```

Entries share one carrier event and commit matching views once. A subscription
that matches several entries re-renders exactly once, using the last matching
entry. Effects then receive each matching logical entry in order. On a
configured non-element `EventTarget` host, batch entries are also mirrored as
native named events so normal EventTarget listeners can consume them.

## Hosts and routing

`events.asHost` makes an element a local routing host:

```tsx
<section mix={events.asHost}>...</section>
```

Element hosts belong with occurrence descriptors. A `.store()` store already
registers its own `EventTarget` as the default host, so do not wrap store
views in an element `events.asHost`: `update()` dispatches on the store target
and hosted views will not receive it.

Events created by one descriptor are ignored by another descriptor even when
their raw names match. Dispatch scope follows the origin target: dispatching on
an element keeps the event on that element (the origin element and its mounted
subscribers, plus the subscriptions of its containing `events.asHost`), while
dispatching on the store target (via `update()` or `host.dispatchEvent`)
broadcasts to the default host scope. Composed events may cross nested
descriptor hosts; non-composed events do not.

For a descriptor configured with a domain host:

```ts
class Drummer extends TypedEventTarget<CustomEventsEventMap<DrummerEvents>> {
  events = customEvents<DrummerEvents>({ host: this })
}
```

mounted mixins naturally consume the hosted events:

```tsx
<output
  mix={drummer.events.tempoSet.on((event) => {
    console.log(event.detail)
  })}
/>
```

Detached code uses `addEventListeners(drummer, signal, { tempoSet() {} })`.

### Address routing

An Immer patch notifies subscriptions whose address is an ancestor or
descendant of the changed path. A leaf mutation therefore updates its leaf,
owning item, collection, and top-level-property views—but no sibling items.

A source with an empty address (a top-level state property, or any occurrence)
subscribes at the root. A change with no address at all — a top-level
property — matches the root and re-renders every subscription, so occurrences
broadcast to every listener.

### Scalar identity routing

Identity-valued state (which row is selected, which cell is focused) is a
scalar routed by value. Each owner subscribes with `.as(ownerId)`:

```ts
state.update((draft) => {
  draft.selected = item.id
})
```

```tsx
<view.button on={events.selected.as(item.id)} aria-pressed={({ detail }) => detail}>
  {item.label}
</view.button>
```

A write to a top-level scalar is addressed to the losing and gaining owners by
value: the losing owner's subscription fires first (re-rendering against the
new value, so the `.as()` detail is `false`), the gaining owner's second, and
untouched siblings do not re-render. Collection (root) subscribers still
observe the final value once. An `.as(id)` view receives the boolean whether
the scalar currently equals `id`; an `.as(id)` effect
(`mix={source.on(...)}`) receives the scalar value in `event.detail`, and
`detail === id` identifies the gaining owner.

Use a `Map` for per-item data or reorderable collections; use `.as()` when the
identity lives in a single scalar.

## Sequencing

One processed event transaction follows this order:

1. Re-render matching views on the event's origin element.
2. Re-render the remaining matching views.
3. Run matching `.on(...)` effects.
4. Resolve `events.dispatch(...)` after returned promises settle.

The origin-first rule follows DOM causality: an element that dispatches an
event observes its own updated attributes before descendant side effects such
as `disabled`-induced `focusout` occur. Effects always see committed DOM. An
element-dispatched event stays local to that element (and its containing
host), so unrelated elements do not re-render; route store-scoped events
through the store target (`update()`/`host.dispatchEvent`) when siblings or
other elements must observe them.

## Design guidance

- Name events as facts that have already happened, usually past-tense domain
  language: `querySubmitted`, `booksFound`, `actionErrored`.
- Hold an event in state when consumers need its current readable value.
- Use an unheld occurrence when repetition matters and there is no meaningful
  current value.
- Put payload in occurrence detail when it is the fact's durable data.
- Prefer a deep state source over broad component invalidation when one existing
  DOM view owns that address.
- Prefer one wildcard mounted effect when the component genuinely renders as a
  cohesive unit.
- Structural creation, deletion, and reordering still belong to the owning
  component render; fine-grained evented-views update existing DOM.
- Reaching for a default-source whole-model view is a signal the component
  renders as a unit; narrow evented-views earn their keep when only a few
  addresses change per event.
