# Custom Events

A typed `EventTarget` where every field is an event name and its value is the current detail.

```tsx
import { Events, evented } from './utils/customEvents/index.tsx'

class CounterEvents extends Events {
  count = 0 // remembered event
  increment(by: number) {
    this.count += by
  } // handler
  done() {} // notification
}
const events = CounterEvents.define()
```

## Define events

Use the intro class above for all dispatch forms:

```tsx
await events.dispatchEvent({ count: 5 }) // remembered — implicit replace
await events.dispatchEvent({ increment: 2 }) // handler — Immer draft
await events.dispatchEvent('done') // notification — no detail kept
```

Handler overrides same-name remembered event:

```tsx
class TemperatureEvents extends Events {
  celsius = ''
  fahrenheit = ''
  setCelsius(v: string) {
    this.celsius = v
    let n = Number(v)
    if (Number.isFinite(n) && v.trim() !== '') this.fahrenheit = String((n * 9) / 5 + 32)
  }
}
```

Read through selectors or `events.details` — never on the descriptor:

```tsx
events.details.count // current detail, readonly-typed
events.count // undefined
```

Unknown keys are a compile error. Only `'*'` is reserved. The base carries only the static. State is a view: `events.details` is `DetailsOf<X>`.

## Effects — `api.on`

`constructor(api)` registers effects. `this` is the draft.

```tsx
class SearchEvents extends Events {
  view: SearchView = { type: 'queryEmpty' }
  query: string | undefined = undefined
  input: HTMLInputElement | undefined
  constructor({ on }: EventsApi<SearchEvents>) {
    super()
    on.query(async function ({ detail }, signal) {
      if (!detail) {
        this.view = { type: 'queryEmpty' }
        return this.input?.select()
      }
      this.view = { type: 'querySubmitted', query: detail }
      let res = await fetch(`/books?q=${detail}`, { signal })
      if (signal.aborted) return
      let j = await res.json()
      this.view =
        'docs' in j && j.docs.length
          ? { type: 'booksFound', books: j.docs }
          : { type: 'booksNotFound', reason: 'emptyList' }
    })
  }
}
```

**Rules:**

```tsx
on.query(async function ({ detail }, signal) { /* ✅ function — rebinds this */ })
on.query(({ detail }) => { this.view=detail }) // ❌ arrow
constructor(api: EventsApi<X>, ...a: Args){ super(); api.on.query(...) } // ✅ plain api
constructor(private api: EventsApi<X>){} // ❌ adds `api` as remembered event
```

| Phase  | Rule                                                                                             |
| ------ | ------------------------------------------------------------------------------------------------ |
| Fires  | only when value at path changes; same-value = no-op                                              |
| Chains | linear: each reaction fires at most once per dispatch; A→B→A updates the detail without re-running A |
| Abort  | `signal` aborts prior run for same selector; further `this`-writes dropped (reads/`create` live) |
| Settle | aborted rejection quiet; real error rejects `dispatchEvent`                                      |

Build hosted events without closure — `api.create` mirrors `events.create`:

```tsx
constructor({ on, create }: EventsApi<SearchEvents>) {
  super()
  on.view(async function ({ detail }, signal) {
    let books=await fetchBooks(detail.query, signal)
    this.input?.dispatchEvent(create({ view:{type:'booksFound',books} }, {signal}))
  })
}
// Eager apply: call only after `await`, not between detail mutation and flush.
```

Deep paths narrow `this`:

```tsx
api.on.columns.get(id).cards.get(cardId)(function ({ detail }) {
  this.urgent = !this.urgent
})
api.on['*'](function () {
  /* every remembered event */
})
```

## Selectors — `events.on.<name>`

Access records a path, not a snapshot.

```tsx
events.on.count
events.on.profile.name
events.on.columns.get(colId).cards.get(cardId).urgent
events.on.values.A0
events.on.items[0].label
events.on.selected.as('green') // boolean
events.on.<selector>(listener)  // mixin — only while mounted
```

Data-independent — register before values exist.

## Subscribed elements — `evented.<tag>`

`evented.button` is a cached component that renders a `<button>` at runtime.

| Variant       | `on`                                            | `children` / prop                | Use            |
| ------------- | ----------------------------------------------- | -------------------------------- | -------------- |
| Single        | `events.on.count`                               | `{(c)=>c}`                       | one value      |
| Reactive prop | `events.on.count`                               | `disabled={(c)=>c===0}`          | derive attr    |
| Tuple         | `[events.on.position.get(i), events.on.result]` | `{([pos])=>pos}`                 | multi-selector |
| Wildcard      | `events.on['*']`                                | `{(d,e)=>e?.type==='done'? ...}` | all details    |
| Notification  | `events.on.done` + `initial`                    | `{(d)=>d && ...}`                | transient      |
| Scalar        | `events.on.selected.as(id)`                     | `aria-pressed={(sel)=>sel}`      | identity       |

Props: `on` | `children` | `initial` | reactive prop | `mix` (`events.on.<selector>(listener)`).

Keyed lists diff by `key`:

```tsx
<evented.svg on={events.on.circles}>
  {(circles) =>
    [...circles.values()].map((c) => (
      <evented.circle
        key={c.id}
        on={[events.on.circles.get(c.id).diameter, events.on.editing.as(c.id)]}
        r={([d]) => (d ?? c.diameter) / 2}
      />
    ))
  }
</evented.svg>
```

```tsx
<input mix={events.on.focusTarget.as(id)(({ currentTarget }) => currentTarget.focus())} />
```

No detached `observe()` — use `addEventListener` on the descriptor.

## Sharing data between components

Need `user` and `settings` in many unrelated components?

```tsx
// 1. Define what is shared — just fields (remembered events)
export class AppContextEvents extends Events {
  user: { name: string; age: number } | null = null
  settings: { theme: 'dark' | 'light' | 'system'; layout: 'zen' | 'normal' } = {
    layout: 'normal',
    theme: 'system',
  }
}
```

```tsx
// 2. Provide once at the root
const events = AppContextEvents.define()
handle.context.set(events)
handle.queueTask(async () => {
  events.dispatchEvent({ user: { name: 'Bob', age: 23 }, settings: { layout: 'zen', theme: 'light' } })
})

// 3. Consume anywhere — pick one:
let events = handle.context.get(AppProvider)
addEventListeners(events, handle.signal, { user(){ handle.update() } }) // imperative
return () => <div>{events.details.user?.name ?? 'Not logged in'}</div>

<e.div on={events.on.user.name}>{(name) => name ?? 'Not logged in'}</e.div> // deep, fine-grained
<e.div on={events.on.settings}>{(s) => `${s.layout}/${s.theme}`}</e.div>     // whole slice
```

## Dispatch & create

| Form               | Example                                     | Sync                 |
| ------------------ | ------------------------------------------- | -------------------- |
| Remembered / batch | `dispatchEvent({count:5})` / `{a:1,b:2}`    | `Promise`            |
| Notification       | `dispatchEvent('done')`                     | `Promise`            |
| Hosted             | `element.dispatchEvent(create({draft:2}))`  | `boolean` if `Event` |
| Init               | `create({view}, {signal,bubbles,composed})` | —                    |

- Draft write `this.otherEvent = v` emits that event.
- Handler call `this.handlerName(detail)` — deferred if batch has uncommitted details, else immediate (committed details).

## Logic that lives outside components

### Make any element draggable

Need `start`/`end` on every card without copying pointer code?

```tsx
// 1. Define what the behavior emits
class DraggableEvents extends Events {
  start(detail: {left:number; top:number}) {}
  end(detail: {left:number; top:number}) {}
}
const events = DraggableEvents.define() // module-singleton, shared by all hosts

// 2. Encapsulate interaction once — emit on the host element
element.dispatchEvent(events.create({ start: {left, top} }))
element.dispatchEvent(events.create({ end: {left, top} }))

// 3. Use anywhere — just add the mixin and subscribe
<div mix={[draggable(true), draggable.events.on.start(({detail})=> {}), draggable.events.on.end(({detail})=> {})]} />
```

### Keep domain state in its own object

Need `bpm`/`isPlaying` to survive unmount and be tested without DOM?

```tsx
// 1. Define domain events
class DrummerEvents extends Events {
  tempoSet(d: number) {}
  playbackStarted(d: number) {}
  playbackStopped(d: number) {}
}

// 2. Own the channel — bridge descriptor to domain target
class Drummer extends TypedEventTarget<EventsMapOf<DrummerEvents>> {
  events = DrummerEvents.define().asHost(this) // bridge
  setTempo(bpm: number) {
    this.#tempoBpm = bpm
    this.dispatchEvent(this.events.create({ tempoSet: bpm }))
  }
  play(bpm = this.bpm) {
    this.#isPlaying = true
    this.dispatchEvent(this.events.create({ playbackStarted: bpm }))
  }
}
// create once (`new Drummer()`), share via prop/context, not `handle.context`
// detached: addEventListeners(drummer, signal, { tempoSet(){ handle.update() } })
// mounted:  <div mix={drummer.events.on.tempoSet(({detail})=> {})} />
// write:    drummer.setTempo(120) // reaches both
```

Host elements create a local scope — children inside see element-dispatched events, outside don't:

```tsx
<section mix={events.asHost()}>
  <e.output on={events.on.view}>{(v) => v.type}</e.output>
</section>
```

Maps/Sets keep real keys, arrays by index; paths use string/number equivalence.

## Async

```tsx
async run(steps: string[]) {
  this.phase='queued'; await delay(80) // flush
  for(let s of steps){ this.phase='running'; this.logEntry(s); await delay(30) }
  this.phase='done'
}
```

Each `await` flushes. Dispatch settles after flushes + effects. Throw leaves committed details (no rollback). Don't hold `this`.

## Sequencing

One batch: origin elements → remaining elements → effects → `await dispatchEvent` resolves.

## Differences from DOM

- No `cancelable`/`preventDefault` — facts only.
- No `detail` in init — `create({name:detail})`; bare name is detail-less.
- `bubbles` defaults `true`.
- Matching by type + path + scope, not DOM propagation.
- Shorthand `dispatchEvent` async (`Promise`); native `Event` sync (`boolean`).
- Descriptor isolation — same name on another descriptor ignored.
- `events.details` is live current details (readonly-typed, not frozen).

## Design guidance

- Name past-tense facts: `querySubmitted`; keep remembered when current detail matters, notification when repetition matters.
- Prefer deep selectors for owned paths; never close over details — read the draft; keep search in one `on.query` effect.

## Terminology

Event library — state is `Record<rememberedEventName, detail>`. DOM terms reused: `event`, `detail`, `dispatchEvent`, `EventTarget`. CustomEvents adds **remembered event** (field), **notification** (empty method), **handler** (method), **effect** (`api.on`/`events.on` with draft `this`), **selector** (`events.on.<path>`), **subscribed element** (`evented.<tag>`), **path**, **batch**, **scope**.

## See Also

- `./INTERNALS.md` — batches, matching, cancellation
- `app/assets/searchBooksWithoutFrame.tsx` — canonical component
- `app/assets/appContext.tsx` — shared descriptor via `handle.context`
- `app/assets/drummer.ts` — domain bridge `asHost(this)`
- `app/assets/draggable.tsx` — mixin `create` + `events.on.start/end`
- `app/assets/sevenGuis/cells.tsx` — element-local `create`
- `app/assets/todolist/` — `composed:true` batches
