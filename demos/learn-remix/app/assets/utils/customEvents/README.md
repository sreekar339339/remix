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

The descriptor is itself the source graph and doubles as the wildcard event
source (see [Evented-views](#evented-views--eventedtag)). The reserved names
`create`, `dispatch`, `on`, `asHost`, and `store` cannot be event names. Native
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

### Evented-views — `evented.<tag>`

`evented.<tag>` is a type-only alias over the intrinsic tag: `evented.button` is
the string `'button'` at runtime, so JSX creates a host element directly — there
is no wrapper component between you and the host. Import it once from the
library root; it is shared by every descriptor and store:

```ts
import { customEvents, evented } from '.../customEvents'
```

The typed overloads preserve source-specific callback inference on top of the
raw `eventSource` host prop. A render function's first argument is the **value
the `eventSource` selects**: the current value at that source's path for one
source, a tuple index-aligned with `eventSource` for several, and the whole
state snapshot for the descriptor's wildcard source (below). The matched event
is the second argument. Passing the descriptor or store descriptor itself as
`eventSource` infers the event map, so wildcard and store views stay fully
typed without binding `evented` per descriptor.

```tsx
<evented.output eventSource={events.startDate}>{(value) => value}</evented.output>
```

Occurrence events (declared but not retained by a store) fill their tuple
slot with the occurrence payload when that occurrence triggered the render and
`undefined` otherwise.

Evented-view props:

| Prop             | Meaning                                                                                                                                                                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `eventSource`    | A source, an array of sources, or the descriptor itself. The first callback argument is the selected value (one source), a tuple aligned with `eventSource` (several), or the whole snapshot/event union for the wildcard descriptor; the matched event is the second. |
| `initial`        | A defined event to render before an occurrence first matches; callbacks receive it as the matched event. Store views need no `initial`.                                                                                                      |
| `children`       | Static children, or a render function of the selected value and matched event.                                                                                                                                                               |
| _reactive props_ | Any native prop may be a function of the selected value and matched event.                                                                                                                                                                   |
| `mix`            | Mixins; use `source.on(...)` for element-owned effects.                                                                                                                                                                |

The descriptor itself is a wildcard event source: passing it as `eventSource`
subscribes the view to every descriptor event. On a store the snapshot is read
for held events and occurrence payloads pass through raw. Because `evented.<tag>`
is a string at runtime, an omitted `eventSource` does not imply a wildcard —
state the wildcard explicitly with `eventSource={events}` (or
`eventSource={store.events}`).

### Descriptor methods

| Member     | Signature                      | Purpose                                                        |
| ---------- | ------------------------------ | -------------------------------------------------------------- |
| `create`   | `create(type, detail?, init?)` | Creates a fresh event `CustomEvent`.                           |
| `dispatch` | `dispatch(target, ...)`        | Dispatches and resolves after view updates and effects settle. |
| `on`       | `on(listener)`                 | Element-owned wildcard effect for every descriptor event.      |
| `asHost`   | `asHost`                       | Makes an element act as a host for this descriptor.            |
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

Destructure the store in the setup scope — `events`, `state`, and `host` are
all stable references, so destructuring snapshots none of them:

```ts
let { events, state, host } = customEvents<FlightEvents>().store({
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

| Member                 | Purpose                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `state.value`          | The current immutable snapshot (`Immutable<State>`); a live read.                                                                    |
| `state.update(recipe)` | Mutates state through an Immer draft and dispatches change events. Read current state from the `draft`.                              |
| `events`               | The descriptor: sources and descriptor methods.                                                                                      |
| `host`                 | The store's `EventTarget`: ordinary `addEventListener` / `dispatchEvent` consumption of state events.                                |
| `evented`              | The shared intrinsic-element namespace; pair it with `eventSource={store.events}` (see [Evented-views](#evented-views--eventedtag)). |

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

Use `evented.<intrinsic>` and pass a source to `eventSource`. Children and native
properties may be functions of the selected value and the matched event; on a
store the selected value is what that source's path reads:

```tsx
<evented.button
  eventSource={events.selected.as(item.id)}
  aria-pressed={(selected) => selected}
  class={(selected) => (selected ? 'selected' : '')}
>
  {item.label}
</evented.button>
```

This is especially useful inside lists. The component remains one readable,
HTML-shaped tree while each existing row, card, circle, or cell updates only
its affected native attributes and children.

Listen to several explicit sources with an array; the selected value becomes a
tuple index-aligned with `eventSource`. Destructure it with names in the
callback for readable multi-source views:

```tsx
<evented.button
  eventSource={[events.position.get(index), events.result]}
  disabled={([, result]) => result !== null}
>
  {([pos]) => pos}
</evented.button>
```

Elide tuple positions the callback does not read (`[, result]`). An evented-view
accepts one source per event type; passing two sources that share a type
throws.

### Dynamic lists

A container with a children function is a live keyed list: the children
callback re-resolves from the event input, and the vdom diff reconciles
additions, removals, and reorders against `key`. Existing rows keep their DOM
nodes and evented state — only the changed rows mount or unmount. No component
update is needed for structural changes:

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

Map item replaces route to the item's own keyed subscription only — the
container's children function does not re-run, so editing one circle never
re-resolves the whole list. Structural changes (item `set`/`delete`) and
whole-key replaces still re-resolve the container, which keyed-diffs the
result.

### Whole-model wildcard view

Pass the descriptor itself to `eventSource` to subscribe the view to every
event. On a store it re-reads the whole state snapshot on mount and re-renders
whenever any state property changes. Occurrence events still arrive raw. The
render function's first argument is the state snapshot on state events and the
occurrence payload otherwise:

```tsx
<evented.output eventSource={events}>
  {(value) =>
    typeof value === 'object' ? `${value.kind} from ${value.startDate}` : value
  }
</evented.output>
```

The snapshot read needs no `initial` because a snapshot always exists. This
makes the evented-view a live read-only view of the whole store — ideal for an
element whose output depends on several properties at once, such as a progress
bar ratio.

### Occurrence vocabulary

A descriptor with no state broadcasts occurrences. Pass the descriptor to
`eventSource` to subscribe the view to every descriptor event:

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

Before an occurrence first matches, the value argument is `undefined` and the
event argument is `undefined`. Supply `initial={events.create(...)}` when a
defined initial occurrence is part of the UI model; the initial event's detail
fills the slot of the source it matches, as if it had just fired. When the
render switches on `event.type`, prefer the event's typed `event.detail` over
the first argument; the first argument is the value of the source, not the
matched occurrence.

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

Patch operations refine the routing. Each entry carries an op per address:
`add`, `remove`, `replace`, or `mapReplace`. A whole-key (`[]`) event always
broadcasts, and any `add`/`remove` (structural) or object/array `replace`
still reaches the root. A `mapReplace` — a keyed patch whose container is a
`Map` — delivers to the keyed route only: the item's own view updates while
collection (root) views skip it. This is what lets a dynamic list container
skip re-resolving its children when one item's value changes.

### Scalar identity routing

Identity-valued state (which row is selected, which cell is focused) is a
scalar routed by value. Each owner subscribes with `.as(ownerId)`:

```ts
state.update((draft) => {
  draft.selected = item.id
})
```

```tsx
<evented.button eventSource={events.selected.as(item.id)} aria-pressed={(selected) => selected}>
  {item.label}
</evented.button>
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
- Give a dynamic list a container children function over `Map` state: keyed
  children diff by `key`, item edits stay on item views, and no component
  update is needed for structural changes.
- Reaching for a whole-model wildcard view is a signal the component
  renders as a unit; narrow evented-views earn their keep when only a few
  addresses change per event.
