Add an `eventSource` prop for host elements, making any JSX element event-aware without a wrapper component. An element with `eventSource` subscribes to its sources while mounted and, on every matched event, re-resolves its reactive props and children through the normal vdom diff — no direct DOM manipulation and no manual update scheduling:

```tsx
<select
  eventSource={[events.people, events.prefix, events.selectedId]}
  value={([, , selectedId]) => selectedId ?? ''}
>
  {([people, prefix]) =>
    visiblePeople(people, prefix).map((person) => <option value={person.id}>{person.name}</option>)
  }
</select>
```

Any non-framework prop also accepts a function of the event input, and `children` accepts a function that returns `RemixNode`. A callback's first argument is the source's current value — a tuple index-aligned with `eventSource` when there are several sources — and the matched event is the second. An optional `initial` event prop supplies the input rendered before an occurrence first matches: its detail fills the slot of the source it matches, as if it had just fired. Server rendering resolves the initial input only; subscriptions are client-side.

Event sources are any object exposing the `EVENT_SOURCE` protocol brand (`{ read?, subscribe(subscriber, signal) }`), so event models can plug in without the renderer knowing their internals. `getEventSourceProtocol()` and the `EventSource`, `EventSourceProtocol`, `EventSourceSubscriber`, `EventSourceEvent`, `EventSourceInput`, and `EventInput` types are exported for event model authors. JSX host props now accept the reactive forms through `JSX.IntrinsicElements`, while `Props<'tag'>` intentionally keeps the non-reactive shapes for component prop types.
