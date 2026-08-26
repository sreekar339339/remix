# Custom Events — Internals

For library authors. Learner API is in `./README.md`.

## Module layout

```
types.ts       — public types: DetailsOf/HandlersOf, selectors, effects, batches
runtime.ts     — kernel: path trie, batch event, scope matching, delivery
evented.tsx    — selector-aware intrinsic components and mounted subscriptions
descriptor.tsx — createCustomEventsDescriptor: create/dispatchEvent/on/asHost
index.tsx      — Events.define(), batch lifecycle, effects, Immer patches → entries
```

## Runtime kernel — `runtime.ts`

### Current details & runtime bookkeeping

```ts
type CustomEventsRuntimeState = {
  eventTypes
  eventTypeListeners
  subscriptions: { view; effect } // Map<string, PathNode>
  dispatchTargets: WeakMap<EventTarget, Registration>
  hosts: WeakMap<Element, number>
  wrappedHosts
  nativeListeners
  defaultHost?
}
type PathNode = { subscriptions: Set<ElementSubscription>; children: Map<unknown, PathNode> }
```

One runtime per descriptor, lazily created. `eventTypes` drives `registerDispatchTarget` listeners.

### Paths

```ts
canonicalAddressSegment(v) // string|number → String, symbol/object → identity
samePropertyKey(a, b) // Object.is || String(a)===String(b) non-symbol
readPath(value, path) // Map (canonical+Number twin+samePropertyKey scan), Set→boolean, Array index, Reflect.get
```

Selectors, patches, and subscriptions all canonicalize identically, so the trie is consistent while reads tolerate string/number equivalence.

### Batch event

```ts
class ProductEvent extends CustomEvent {
  entries: CustomEventsRuntimeEntry[] // {type, detail, paths?}
  batch: boolean // entries.length!==1 || entries[0].type!==type  (was `transaction`)
  completion?: Promise<void>
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
findHost(el) // walk parentElement chain for hosts WeakMap
scopeFor(el) // findHost(el) ?? defaultHost
matchesScope(runtime, sub, carrier, originScope, originTarget)
// 1) originTarget element === sub.element → true
// 2) !carrier.bubbles && isElement(originTarget) && sub.element!==originTarget → false
// 3) !isElement(originTarget) → true  // descriptor/bridged domain broadcasts
// 4) else scopeFor(sub.element) === originScope || (composed && contains)
```

Element host: `hosts` counter + `registerDispatchTarget`. Domain target: `wrappedHosts` monkey-patches `addEventListener/removeEventListener` to count `nativeListeners` (excluding `processListener` symbol), sets `defaultHost = target`.

### Dispatch & process

```ts
createProductEvent(runtime, carrierType, detail, init, entries) // also addEventType
dispatch(runtime, target, event) // EventTarget.prototype.dispatchEvent.call(target, event); return completion ?? RESOLVED
registerDispatchTarget(target) // AbortController + per-type process(event) listeners with processListener symbol
process(event) // only ProductEvent: originTarget=event.target; originHost=findHost(originTarget); stopPropagation if hosted && !composed; fan out entryEvents per-entry for nativeListeners when batch && origin===defaultHost; originScope = originHost ?? (isElement(originTarget)?originTarget:defaultHost??originTarget); notifyEntries(...)
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

Was `subscribeSource`; canonical term is now selector.

## Descriptor — `descriptor.tsx`

### `RememberedEventContext`

```ts
type RememberedEventContext = {
  getState(): EventDetails
  fold(type, detail, owner?: AbortSignal): Entry[] | { entries; settle } | undefined
  dispatchEntries(entries): Promise<void>
  pendingBatch(): boolean // was pendingSession
  deferDispatch(run: () => Promise<void>): Promise<void>
  notificationKeys(): ReadonlySet<string> // was occurrenceKeys
}
```

### `createCustomEventsDescriptor`

Holds `runtime` (lazy), `base = new EventTarget` (defaultHost), `settlers: Promise<void>[]`, `state.dispatchEntries = (entries) => dispatch(defaultHost, createBatch(entries))` (was `createTransaction`).

- `resolveEntry(type, detail, init)` — `init.signal.throwIfAborted()`, `ALL_EVENTS` guard, `state.fold(type,detail,init.signal)`, settle push.
- `createBatch/createProductEvent/buildProduct` — single entry → carrier type = entry.type; else `$batch` with `bubbles:true` (was `$transaction`).
- `create(...args)` — `string` → bare, `Record` → single-key fast path vs multi-key loop → `buildProduct`. Validates `CustomEventInit` (`bubbles/composed/signal` only, `cancelable` throws).
- `wildcardSelector` — selector metadata with `type:'*', read=>getState`, subscribe as view wildcard.
- `performDispatch(...args)` — `instanceof Event` → native boolean; else `create` → `defaultHost` → `dispatch` + `Promise.all(settlers)`.
- `dispatchEvent` wrapper — `if (pendingBatch()) return deferDispatch(()=>performDispatch(...))` else direct (was `pendingSession`).
- `hostMixin = ref((target,signal)=>registerHost(runtime,target,signal))`; `asHost():Mixin` vs `asHost(target):descriptor`.
- `on` proxy — `'*'` → `wildcardOn`; else `createSelector(property)` lazy, cached in `selectors` Map. `createSelector` defers field-existence check to `read` at delivery (so constructor-time registrations precede field initializers).
- `createSelector(type, path, read?)` — `metadata {type,path,read: read ?? ((trigger)=> Object.hasOwn(current,type) && !notificationKeys.has(type) ? readPath(current[type],path) : trigger?.type===type ? trigger.detail : undefined), subscribe}`; callable proxy `onNode` → `customEventsOnMixin`; `nested` Map of canonical segments → `at(segment,read?)`; `get/has/as` via `at`.

## Details & batches — `index.tsx`

### Setup

```ts
enablePatches()
enableMapSet()
setAutoFreeze(false)
export const evented = customEventsEvented as CustomEventsEventedViews<EventDetails, never>
```

### `defineEvents(Class, ...args)`

Collects `handlers` from `Class.prototype` (`Object.getOwnPropertyNames` minus constructor, `typeof value==='function'` → `((detail,draft)=>method.call(draft,detail))`).

Wires `BatchRef {current?: {dirty,stale?,flushNow?}}` (was `FoldSessionRef`), `DeferredQueue {defer,drain}`, `pendingBatch=()=>dirty`, `notificationKeys=()=>Set(handlers.keys())`, `effects: Effect[]` (was `reactions`), `context`, `descriptor`, `api = {on: createEffectNamespace(descriptor.on), create: descriptor.create}`, `instance = new Class(api,...args)`, `immerable` non-enumerable, handler shadows `instance[name]=(detail)=>void dispatchEvent({[name]:detail})`.

### Batch

```ts
type Batch = { dirty; stale?; flushNow?: () => void }
```

`runBatch(handler, type, detail, live, handlerNames, batchRef, deferred, dispatchEntries, cross?)` (was `runFoldRecipe`):

- Captures `previousBatch = batchRef.current`; `previousBatch?.flushNow?.()` **before** opening draft — commits parent so nested reads it; marks `previousBatch.stale=true`; installs `batch`; `currentDraft = createDraft(live)` **after** flush.
- `draftProxy` — `get` schedules batch, `handlerNames.has(p)` → `Reflect.get(live,p)`, else `Reflect.get(currentDraft,p)`; `set/has/deleteProperty` schedule/filter dirty.
- `flush()` — `finishDraft(currentDraft, patches=>...)` → `entriesFromPatches(live,next,patches)` → `mirrorKeys(live,next,entries)` → `asyncMode ? flushed.push(dispatchEntries) : sliceEntries.push`; effect queue: per-entry `matched=[byKey.get(type), wildcards]` not suppressed, path-matched (`shared===len` test), `queue.push`; `while(queue)` → `fireWithSignal` + `trackRun` → `cross.runs.push` if promise; `fires` budget `MAX_REACTION_FIRES`. `deferred.drain()` per flush.
- `drain()` — `while(true){ if(stale) rebuild createDraft(live); flush(); if(!dirty) break }`.
- `handler(detail, draftProxy)` → `effectRuns = cross?.runs ?? []`; branch:
  - `result instanceof Promise` → asyncMode, entries `[{type,detail}]`, settle awaits `[result,...effectRuns]` then drain+flushed.
  - `effectRuns.length>0` (sync body fired async effects) → same asyncMode path after initial `drain()` into `sliceEntries`.
  - else sync → `drain()` then return `sliceEntries` or `{entries,settle:deferred}`.
- `batch.flushNow = ()=>void flush()` assigned after `flush` for parent-nest use.

### Effects & cancellation

```ts
type Effect = {type, path, callback}
createEffectNamespace(descriptorOn, effects): Proxy
```

`effectSignals: Map<Effect,AbortController>`, `gateWrites(receiver, signal)` proxy dropping `set/delete/defineProperty` when `signal.aborted`, `trackRun(result,signal)` swallowing `AbortError`/aborted rejections.

`fireWithSignal(effect, receiver, event, owner?)`:

- `current = map.get(effect)`
- `owner!==undefined && owner===current.signal` → **owned publish** — reuse controller, gate receiver, `trackRun(callback.call(gated,event,current.signal))`.
- else `current?.abort(); controller=new AbortController(); map.set(effect,controller); gateWrites(receiver,signal); trackRun(call)`.

`createFoldEntry` (now `createBatchEntry`) — `effectIndex` lazy, `fireWithSignal` owner-aware, `runFieldEffects` synthetic batch writing `draft[type]=value`, firing effects inline (collecting `runs` promises), cross with `suppress:fired, runs`.

### Patches → entries

```ts
sliceAddresses(prev, next) // primitive→[[prev],[next]] filtered nullish; Set→[[canonical(next)]]; else [[]]
mirrorKeys(live, next, entries) // live[key]=next[key] or delete
entriesFromPatches(prev, next, patches) // Map<string,path[]> per patch.path[0]; Set→value segment; else path[1..] canonicalized; appendAddress dedup; primitive override via sliceAddresses; emit {type,detail:next[key],paths}
```

## Build & test

- No build step — tests run from source via `remix/node-tsx`.
- `pnpm -C demos/learn-remix run typecheck`, `pnpm -C demos/learn-remix test` (server + Chromium), `pnpm run lint` (oxlint). Browser tests assert Chromium focus.
- Test helpers: `customEvents.test-utils.tsx` `TestEventsFactory`, `createEvents()`, `settleEffects()` (3 microtasks).
