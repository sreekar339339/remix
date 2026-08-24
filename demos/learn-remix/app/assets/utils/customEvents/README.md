# Custom events

`customEvents` is an enhancement on top of the DOM Events API. An `Events`
instance is a typed `EventTarget`: everything the DOM provides works on it
exactly — `addEventListener`/`removeEventListener`, `dispatchEvent(event)`
returning a `boolean`, and `CustomEvent` instances with `type`, `detail`,
`target`, and `currentTarget`. On top of that foundation the library adds:

- **Shorthand inputs** — `dispatchEvent('name')` and
  `dispatchEvent({ name: detail, ... })` build and dispatch `CustomEvent`s
  for you; the object form commits several events atomically.
- **A live model** — the instance holds the composite; dispatching an event
  folds a new value into it. The instance you hold reads the current model at
  all times.
- **Fold recipes** — a method of the model interprets an event and mutates an
  Immer draft; the resulting patches drive the routing. Recipes may be async
  and may call other events.
- **Addressable subscriptions** — `events.on.<name>` sources subscribe
  narrow consumers to one event and re-render exactly the affected
  addresses.
- **Element lifecycles** — Remix mixins (`on('click', ...)` for native events,
  `events.on.<source>(listener)` for element-owned effects, `asHost()` for
  hosts) wire subscriptions and effects to mounted elements.

The library is organized around these concepts:

- **Events instance** — a subclass of `Events` declares the model as fields
  and events as methods; an empty recipe is a transient occurrence. The
  instance IS the descriptor: `events.on`, `events.dispatchEvent`,
  `events.create`, `events.asHost`, and the native `EventTarget` channel.
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

## The Events model

Declare the model as a class extending `Events`: **fields** are events
(each field is an event whose latest detail is the current value) and
**methods** are fold recipes — an empty recipe is a transient occurrence.
`GameEvents.define()` builds the descriptor and returns the event surface:

```ts
import { Events, evented } from './utils/customEvents/index.tsx'

class GameEvents extends Events {
  count = 0
  increment(by: number) {
    this.count += by
  }
  stepCompleted(detail: string) {}
}

let events = GameEvents.define()
```

The base carries only the static — its instance side stays empty, so a
static name can never collide with user event names (fold methods live on
the prototype, statics on the class).

The returned object is the pure event surface — the descriptor machinery
only. The model is read through views or `events.detail.<name>`:

- **Fields are slices.** `count` is an event whose current value is the field.
  Dispatching `{ count: 5 }` replaces it — the implicit "replace itself"
  fold. Writing the field inside a fold recipe emits the same event.
- **Methods are fold recipes.** Dispatching `{ increment: 2 }` runs the
  recipe against an Immer draft of the model; its mutations become the slice
  events and routing addresses; dispatching `{ increment: 2 }` runs the
  recipe. Fold methods are recipe-internal: calling `this.increment(2)`
  inside a session defers the dispatch until the session commits.
- **Empty recipes are occurrences.** `stepCompleted` fires and leaves no
  trace; calling `events.stepCompleted('done')` is identical to dispatching
  `{ stepCompleted: 'done' }`.
- **The model is live.** `events.detail` reads the current composite; reads
  are guarded by readonly types, not runtime freezing.

A fold that shares a field's name **shadows** the slice: dispatching the name
runs the recipe instead of the implicit replace-itself fold, so the recipe
owns the update — the typical pattern for related events, where one event's
fold derives another detail from its payload. The slice remains the read
surface (`events.on.<name>` reads its current value); only the write
semantics change:

```ts
class TemperatureEvents {
  celsius = ''
  fahrenheit = ''
  setCelsius(value: string) {
    this.celsius = value
    let number = Number(value)
    if (Number.isFinite(number) && value.trim() !== '') {
      this.fahrenheit = String((number * 9) / 5 + 32)
    }
  }
  setFahrenheit(value: string) {
    this.fahrenheit = value
    let number = Number(value)
    if (Number.isFinite(number) && value.trim() !== '') {
      this.celsius = String((number - 32) * (5 / 9))
    }
  }
}
```

Writing `this.fahrenheit` in the celsius fold emits a `fahrenheit` slice
event, so subscribers to `events.on.fahrenheit` and the wildcard already react
to the derived value — no separate dispatch needed.

Every property of the composite is an event name, and every event name is
writable. The object form of `dispatchEvent` and `create` names declared
events — slices and folds — so an unknown key is a compile error.
The bare-name form (`dispatchEvent('name')`) and the native channel
(`addEventListener`, bridged targets) dispatch any name as an occurrence.
The returned object carries no model names: fields and fold methods are
never properties of it — `events.count` is `undefined`; the model is read
through views or `events.detail.count`. The class itself reserves nothing —
a field may share a descriptor name, with those names winning on the
returned object. Only the `'*'` wildcard is unavailable as a dispatch name:
it is the subscription sentinel.

The object form computes its values at the call site; the current model
reads through `events.detail`, so inputs read it directly:

```tsx
<input
  mix={on('input', ({ currentTarget }) => {
    events.dispatchEvent({
      celsius: currentTarget.value,
      fahrenheit: formatTemperature((parseTemperature(events.detail.celsius) * 9) / 5 + 32),
    })
  })}
/>
```

Per-name values are plain data: a function value of an event name is
delivered as the detail itself, never invoked.

### Fold sessions

Fold recipes mutate an Immer draft of the composite; a no-op fold emits
nothing but its own event. Immer patches drive the routing: keyed writes keep
per-item granularity, scalar writes route by owner identity, and deep
mutations reach exactly the affected addresses.

**Async recipes.** A recipe that returns a promise keeps its draft session
open: mutations between `await`s reach views at each microtask boundary, so a
loading flag flips before the awaited work completes, and the dispatch
settles only after the recipe and all its flushes finish:

```ts
class JobRunnerEvents {
  phase: 'idle' | 'queued' | 'running' | 'done' | 'failed' = 'idle'
  log: string[] = []

  async run(steps: string[]) {
    this.phase = 'queued'                  // flushed immediately
    this.logEntry(`queued ${steps.length} steps`)
    await delay(setupDelayMs)
    for (let step of steps) {
      this.phase = 'running'
      this.logEntry(`done with ${step}`)
      await delay(stepDelayMs)
    }
    this.phase = 'done'
  }
}
```

**Calling other events from a recipe.** Most cross-slice updates need no
dispatch: writing the draft of a fold emits the slice's event and reaches
every subscriber. Reach for `this.<fold>(...)` inside a recipe when the
target is itself a fold (including an empty recipe — an occurrence). While the session
has uncommitted mutations, such a dispatch is deferred until the session's
next flush commits; while the draft is clean it runs immediately. Either way
it reads and writes the committed composite — never the in-flight draft
window — so nested events can't observe uncommitted writes. The dispatch
settles after the nested events too.

**Failures.** A recipe that throws after some of its flushes committed leaves
those updates applied and the UI reflecting them (there is no rollback);
mutations still unflushed when the recipe rejects are discarded. The session
handle (the recipe's `this`) is draft-scoped: holding it past the recipe and
mutating it later is unsupported.

**Reads are views or the live instance**: subscribe `on={events.on['*']}`
for the whole composite or `on={events.on.<name>}` for one remembered value. The
instance is the live composite — dispatches fold in place — so native
listeners (`addEventListener`) read current values straight from the instance.
Read values are readonly-typed (`Immutable`), so views and dispatch
inputs cannot mutate the model at compile time; only fold drafts and the
instance itself write.

## Building events — `events.create`

`create` is the typed `CustomEvent` constructor. The second argument is a
`CustomEventInit`: the DOM init dict (`bubbles`, `composed`) plus `signal`,
and deliberately no `detail` or `cancelable`. A bare name builds a
detail-less event; an object of event-named details builds a single event
(one entry) or an atomic transaction carrier (several). The descriptor also
carries
native `EventTarget` listeners, so consumption works directly on the events
object:

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
class Drummer extends TypedEventTarget<EventsMapOf<DrummerEvents>> {
  events = DrummerEvents.define().asHost(this)
}
```

## Defining a composite — `GameEvents.define()`

`define` builds a composite from the subclass: fields are held
slices, methods are fold recipes, and the constructor's `api` registers
session reactions. The returned object carries the descriptor machinery and
reads the live composite through `events.detail`:

```ts
class TemperatureConverterEvents extends Events {
  celsius = ''
  fahrenheit = ''
  constructor(api: EventsApi<TemperatureConverterEvents>) {
  celsius = ''
  fahrenheit = ''
  constructor(api: EventsApi<TemperatureConverterEvents>) {
    api.on.celsius(function ({ detail }) {
        let number = Number(detail)
        if (Number.isFinite(number) && detail.trim() !== '') {
          this.fahrenheit = String((number * 9) / 5 + 32)
        }
      })
    }
  }
}
let events = TemperatureConverterEvents.define()
```

The class carries only the inherited static — nothing is reserved on the
instance, so a field may even share a machinery name (the descriptor names
win on the returned object). The
constructor receives the reaction surface `api.on` — the class-side
counterpart of the element-effect `events.on` — with the same source
vocabulary and a fully typed callback: the event detail is the value at the
source path, and `this` is bound to the session (the same rebinding fold
recipes use), so derivations commit in the same carrier with full patch
routing.

- Dispatch-only: writing a slice is `events.dispatchEvent({ celsius: '25' })`;
  the implied slice write and the reaction run as one session.
- A reaction fires when the value at its source path changes; a same-value
  dispatch is a no-op.
- Deep paths react to the value at that address, with `this` bound to the
  item and the detail typed to it:
  `api.on.columns.get(id).cards.get(cardId)(function ({ detail }) {
  this.urgent = !this.urgent })`. The `get`/`has`/`as` accessors are
  data-independent, so deep chains can be registered before values exist.
- The wildcard `api.on['*'](callback)` observes every slice dispatch.
- Prefer reactions over set-<Field> folds for slice ownership: a field whose
  update derives siblings is a slice plus `api.on.<field>` reactions, while
  an operation (a fold that reads other state or mutates collections) stays
  a fold dispatched by name.

## Event sources — `events.on.<name>`

Every declared event is exposed as a typed source:

```ts
events.on.count
events.on.stepCompleted
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

## Evented-views — `evented.<tag>`

`evented.<tag>` is a type-only alias over the intrinsic tag: `evented.button`
is the string `'button'` at runtime. A render function's first argument is the
**detail** the `on` selects — the source's current value (the whole composite
for the descriptor's wildcard). The matched event is the second argument,
always called `event`, and its `currentTarget` is the evented element itself
(null for the initial event, which precedes any element):

```tsx
<evented.output on={events.on.startDate}>{(detail) => detail}</evented.output>
```

Evented-view props:

| Prop             | Meaning                                                                                                                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `on`             | A source, an array of sources, or the wildcard `events.on['*']`. The first callback argument is the selected value (one source), a tuple (several), or the whole composite (the wildcard); the matched event is the second. |
| `initial`        | A defined event to render before an occurrence first matches; callbacks receive it as the matched event. Remembered views need no `initial`.                                                                           |
| `children`       | Static children, or a render function of the selected value and matched event.                                                                                                                                         |
| _reactive props_ | Any native prop may be a function of the selected value and matched event.                                                                                                                                             |
| `mix`            | Mixins; use `events.on.<source>(...)` for element-owned effects.                                                                                                                                                       |

## Descriptor methods

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
await events.dispatchEvent({ kind: 'return flight' }) // folds in
await events.dispatchEvent('bookingConfirmed') // bare name: an occurrence
await events.dispatchEvent({ kind: 'one-way flight', startDate }) // both fold in atomically
element.dispatchEvent(events.create({ countDrafted: 2 })) // hosted elements
```

`dispatchEvent(event)` returns the native `boolean`; the input form returns a
`Promise` that resolves after view updates and effects settle.

## Consumption patterns

### Narrow evented-views

```tsx
<evented.button on={events.on.selected.as(item.id)} aria-pressed={(selected) => selected}>
  {item.label}
</evented.button>
```

Listen to several explicit sources with an array; the selected value becomes
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
        on={[events.on.circles.get(circle.id).diameter, events.on.editingCircleById.as(circle.id)]}
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

Pass `events.on['*']` to `on` to subscribe to every event. The first
argument is always the whole composite; the matched event is the second:

```tsx
<evented.output on={events.on['*']}>
  {(detail, event) =>
    event?.type === 'bookingConfirmed'
      ? `You have booked a ${detail.kind}.`
      : `${detail.kind} from ${detail.startDate}`
  }
</evented.output>
```

### Occurrence views

Empty-recipe events are transient with no remembered slice. Subscribe a
source (or a wildcard view) to see them; the source value is the
occurrence's detail, `undefined` before a first match:

```tsx
<evented.output on={events.on.bookingConfirmed} aria-label="flight">
  {(flight) => flight && `Booked ${flight.startDate} → ${flight.returnDate}`}
</evented.output>
```

When a wildcard render switches on `event.type`, prefer the event's typed
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
class Drummer extends TypedEventTarget<EventsMapOf<DrummerEvents>> {
  events = DrummerEvents.define().asHost(this)
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
- **Live composite detail.** The instance is the current, readable model; a
  DOM `CustomEvent.detail` is a one-shot snapshot. Reads are guarded by
  readonly types, not runtime freezing: the instance stays the mutable live
  model.

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
  empty recipe when repetition matters and there is no meaningful current
  value.
- Prefer a deep source over broad component invalidation when one existing DOM
  view owns that address; prefer one wildcard mounted effect when the component
  genuinely renders as a cohesive unit.
- Fold recipes read the composite through their draft; never hold a stale
  closure over model values.
- Reaction callbacks must be `function` declarations, not arrows: the runner
  rebinds `this` to the session, and arrows capture the registration-time
  `this` instead.
- Register reactions in the constructor body against the plain `api` param —
  a parameter property would add an `api` field to the composite, and field
  initializers run before the constructor body assigns it.
- Reaching for a whole-model wildcard view is a signal the component renders
  as a unit; narrow evented-views earn their keep when only a few addresses
  change per event.