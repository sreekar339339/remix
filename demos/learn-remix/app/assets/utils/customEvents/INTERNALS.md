# Custom Events — Internals

For library authors. Learner API is in `./README.md`.

## Module layout

```
types.ts       — public types: DetailsOf/HandlersOf, selectors, effects, batches (+ local Draft/Immutable)
runtime.ts     — kernel: path trie, batch event, scope matching, delivery
evented.tsx    — selector-aware intrinsic components and mounted subscriptions
descriptor.tsx — createCustomEventsDescriptor: create/dispatchEvent/on/asHost
index.tsx      — Events.define(), journal (COW draft, write-time paths), batch sessions, linear cascades
```

## Runtime kernel — `runtime.ts`

### Current details & runtime bookkeeping

```ts
type RuntimeState = {
  eventTypes
  eventTypeListeners
  subscriptions: { view; effect } // Map<string, PathNode>
  dispatchTargets: WeakMap<EventTarget, Registration>
  defaultHost?
}
type PathNode = { subscriptions: Set<ElementSubscription>; children: Map<unknown, PathNode> }
```

One runtime per descriptor, lazily created. `eventTypes` drives `registerDispatchTarget` listeners.

### Paths

```ts
canonicalPathSegment(v) // string|number → String, symbol/object → identity
samePropertyKey(a, b) // Object.is || String(a)===String(b) non-symbol
readPath(value, path) // Map (canonical+Number twin+samePropertyKey scan), Set→boolean, Array index, Reflect.get
```

Selectors, patches, and subscriptions all canonicalize identically, so the trie is consistent while reads tolerate string/number equivalence.

### Batch event

```ts
class BatchEvent extends CustomEvent {
  entries: CustomEventsRuntimeEntry[] // {type, detail, paths?}
  batch: boolean // entries.length!==1 || entries[0].type!==type
  completion?: Promise<void>
  settles?: Array<Promise<void>> // batch-session completions the dispatch awaits
}
```

One object is both event and entry table — runtime never looks up a side table. `detail` is redefined to keep the exact dispatched value.

### Path trie — `walkAddress / addToRoute / removeFromRoute / selectRoute`

- `selectRoute(root, paths, selected)`:
  - `paths===undefined` → whole subtree (`collectBranch`)
  - else whole-key subscribers always + per-path descent + branch collect when `depth===path.length`
- Field routing (`sliceAddresses` in `index.tsx`) produces `[[prev],[next]]`; set `[[canonical(next)]]`; deep `[[...canonical(path[1..])]]`.

### Scope

```ts
findHost(el) // el.closest('[data-rmx-custom-host]')
scopeFor(runtime, el) // findHost(el) ?? defaultHost
matchesScope(runtime, sub, carrier, originScope, originTarget)
// 1) originTarget element === sub.element → true
// 2) !carrier.bubbles && isElement(originTarget) && sub.element!==originTarget → false
// 3) !isElement(originTarget) → true  // descriptor/bridged domain broadcasts
// 4) else scopeFor(sub.element) === originScope || (composed && contains)
```

Element host: `registerHost` writes a refcounted `data-rmx-custom-host` attribute (scopes resolve via `closest`, no descriptor-side walk) + `registerDispatchTarget`. Domain target: sets `defaultHost = target`.

### Dispatch & process

```ts
createBatchEvent(runtime, carrierType, detail, init, entries) // also addEventType
dispatch(runtime, target, event) // EventTarget.prototype.dispatchEvent.call(target, event); return completion ?? RESOLVED
registerDispatchTarget(target) // AbortController + per-type process(event) listeners
process(event) // only BatchEvent: originTarget=event.target; originHost=findHost(originTarget); stopPropagation if hosted && !composed; mirror entryEvents per-entry on NON-ELEMENT origins when batch (they double as subscription snapshots); originScope = originHost ?? (isElement(originTarget)?originTarget:defaultHost??originTarget); notifyEntries(...)
```

`notifyEntries(entries, originScope, originTarget, carrier, entryEvents?)`:

- Subscribed elements first, backwards visited set so last forward match wins per subscription.
- `commit = (list) => Promise.all(list.map(([sub,i])=>sub.notify(snapshot(i))))`; origin views first.
- Then subscribed effects per-entry forward: `matchingSubscriptions(effect, entry)` → `matchesScope` → `collect(effectResults, ()=>sub.notify(snapshot))` → `Promise.all`.

### Selector lowering

```ts
subscribeSelector(runtime, phase, subscriber, signal, selector?: {type, path})
  // eventTypes = selector? Set([type]) : null (wildcard); paths = selector? Map([[type, path]]) : {}
  // notify wraps createCurrentTargetEvent(event, subscriber.element) when element present
```

## Descriptor — `descriptor.tsx`

### `BatchContext`

```ts
type BatchContext = {
  getState(): EventDetails
  apply(type, detail, owner?: AbortSignal): Entry[] | { entries; settle } | undefined
  dispatchEntries(entries): Promise<void>
  pendingBatch(): boolean
  deferDispatch(run: () => Promise<void>): Promise<void>
  notificationKeys(): ReadonlySet<string>
}
```

### `createCustomEventsDescriptor`

Holds `runtime` (lazy), `base = new EventTarget` (defaultHost); `state.dispatchEntries = (entries) => dispatch(defaultHost, createBatch(entries))`.

- `resolveEntry(type, detail, init, settles)` — `init.signal.throwIfAborted()`, `ALL_EVENTS` guard, `state.apply(type,detail,init.signal)`, settle collected into the caller's array.
- `createBatch/buildBatch` — single entry → carrier type = entry.type; else `$batch` with `bubbles:true`; `event.settles = settles` rides the carrier.
- `create(...args)` — `string` → bare, `Record` → single-key fast path vs multi-key loop → `buildBatch`. Validates `CustomEventInit` (`bubbles/composed/signal` only, `cancelable` throws).
- `wildcardSelector` — selector metadata with `type:'*', read=>getState`, subscribe as view wildcard.
- `performDispatch(...args)` — `instanceof Event` → native boolean; else `create` → `defaultHost` → `dispatch` + `Promise.all(event.settles)`.
- `dispatchEvent` wrapper — `if (pendingBatch()) return deferDispatch(()=>performDispatch(...))` else direct (was `pendingSession`).
- `hostMixin = ref((target,signal)=>registerHost(runtime,target,signal))`; `asHost():Mixin` vs `asHost(target):descriptor`.
- `on` proxy — `'*'` → `wildcardOn`; else `createSelector(property)` lazy, cached in `selectors` Map. `createSelector` defers field-existence check to `read` at delivery (so constructor-time registrations precede field initializers).
- `createSelector(type, path, read?)` — `metadata {type,path,read: read ?? ((trigger)=> Object.hasOwn(current,type) && !notificationKeys.has(type) ? readPath(current[type],path) : trigger?.type===type ? trigger.detail : undefined), subscribe}`; callable proxy `onNode` → `customEventsOnMixin`; `nested` Map of canonical segments → `at(segment,read?)`; `get/has/as` via `at`.

## Journal & batches — `index.tsx`

The kernel is a copy-on-write draft journal that records affected paths at
write time. No immer: no patches, no freezing, no revoked drafts — handles
stay valid across commits, so async listeners keep mutating between awaits.

### Draft handles

```ts
type Handle = {
  journal; source           // ORIGINAL node (never mutated)
  ancestors                 // self-inclusive originals: ancestors[i] ↔ keys[i]
  keys                      // RAW key forms (numeric twins preserved)
  proxy
}
```

- Reads resolve `copies.get(source) ?? source`; writes `copyForWrite` the
  leaf, then link child copies up the ancestor chain; the top-level
  candidate is always `ancestors[0]`.
- Map `.get(k)` resolves the ACTUAL stored key (numeric twin /
  `samePropertyKey` match) so ancestry keeps raw form; iteration methods are
  bound to the current copy, so `new Map(draft)` snapshots the generation.
- Root-level whole-slice replacements: primitives stage in `stagedRoot`
  (readable mid-session); objects anchor a child handle so later descents
  mutate drafted copies, never the caller's reference.
- Same-value writes (`Object.is`) are no-ops — no copy, no route (immer
  parity, keeps `Object.assign`-style bulk writes patch-free).
- `Map.set/delete` route by key, `Set.add/delete` by value, `clear`
  enumerates members; array mutators expand the touched range into
  per-index routes (immer-parity fan-out).
- `finalizeValue` walks modified subtrees converting embedded handles to
  clean values, so mid-handler snapshots (`history.push(new Map(draft))`)
  hold generation-faithful data. Handles registered in `handleSources`
  (introspection bypasses traps).
- Child-handle registries stamp the generation; commit bumps it, so stale
  handles re-anchor on published identities.

### Batch sessions

`runBatch(batchFn, type, detail, live, batchNames, sessionRef, deferred, dispatchEntries, cross?)`:

- `previousSession?.flushNow?.()` commits the parent before opening; new
  journal per session; `journal.onWrite = () => { session.dirty = true;
  scheduleFlush() }`.
- `flush()` — `commitJournal` publishes changed keys onto `live` and emits
  entries `{type, detail, addresses}`; cross-fire loop matches reactions,
  queues routed ones, fires with the journal root (path `[]`) or the walked
  proxy at the reaction's path; `deferred.drain()` per flush.
- `drain()` — `while (session.dirty) flush()`; fired reactions' writes
  reopen generations so derived slices land before callers observe settle.
- Async: `batchFn` promise or reaction continuations keep the session open;
  `settle` awaits runs, drains again, then restores `sessionRef`.

### Linear cascades

The session-wide visited set (`fired`) fires each reaction **at most once
per dispatch** — inline field firings register in the same set the
cross-fire loop checks. A committed write that routes to an already-fired
reaction still lands (the detail updates) but the callback does not
re-run: A→B→A converges instead of cycling. Self-retriggering is an
explicit re-dispatch (`api.create`/`dispatchEvent` — a new cause, a new
session). There is no fire budget and no cycle throw.

### Effects & cancellation

`effectSignals: Map<Effect,AbortController>`, `gateWrites(receiver, signal)`
proxy dropping `set/delete/defineProperty` when `signal.aborted`,
`trackRun(result, signal)` swallowing `AbortError`/aborted rejections,
owner-aware `fireWithSignal` reusing the run's controller for owned
publishes. `createBatchEntry` — `effectIndex` lazy, `runFieldEffects`
synthetic batch writing `draft[type]=value`, firing effects inline
(collecting `runs`), cross with `suppress: fired, runs`.

### Routes

```ts
sliceAddresses(prev, next) // primitive→[[prev],[next]] filtered nullish; Set→[[canonical(next)]]; else [[]]
```
Entries build directly from the journal's per-key change records (deduped
at write time via `seen`) — no patch post-pass.

## Build & test

- No build step — tests run from source via `remix/node-tsx`.
- `pnpm -C demos/learn-remix run typecheck`, `pnpm -C demos/learn-remix test` (server + Chromium), `pnpm run lint` (oxlint). Browser tests assert Chromium focus.
- Test helpers: `customEvents.test-utils.tsx` `TestEventsFactory`, `createEvents()`, `settleEffects()` (3 microtasks).
- Benchmarks (`benchmark:custom-events`, `benchmark:list-updates`, journal kernel, Chromium): fold dispatch 500× ≈ 0.14 ms/dispatch over a 1,000-entry Map; no-subscriber dispatch ≈ 0.001 ms; addressed matching over 5,000 subscriptions ≈ 0.002 ms/dispatch; list updates ≈ 0.2 ms/op at one `childList` mutation per keyed op.
