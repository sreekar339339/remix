import { clientEntry, css, on, ref } from 'remix/ui'
import type { Handle, RemixNode } from 'remix/ui'
import type { Draft } from 'immer'
import { customEvents, evented } from '../utils/customEvents/index.tsx'

type FilterItem = { id: number; name: string; rank: number }
type SortKey = 'id' | 'name' | 'nameDesc' | 'rank'
type FilterBoardState = {
  catalog: Map<number, FilterItem>
  visible: Map<number, FilterItem>
  meter: number
  timing: Timing
}
type FeedItem = { id: number; label: string; value: number }
type FeedBoardState = { items: Map<number, FeedItem>; meter: number; timing: Timing }
type HeavyItem = { id: number; title: string; done: boolean; priority: number; edits: number }
type HeavyBoardState = { items: Map<number, HeavyItem>; meter: number; timing: Timing }

const filterItemCount = 3000
const palette = [
  'crimson',
  'azure',
  'emerald',
  'gold',
  'violet',
  'rose',
  'teal',
  'amber',
  'indigo',
  'coral',
]

const feedCap = 300
const feedIntervalMs = 400
const heavyCount = 200
const churnIntervalMs = 250
const priorityColors = ['#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#2563eb']

const cardCss = css({
  padding: 18,
  border: '1px solid #d4d4d8',
  borderRadius: 8,
  backgroundColor: 'white',
  color: '#18181b',
  display: 'grid',
  gap: 12,
  '& h3': {
    marginTop: 0,
  },
  '& header p': {
    marginBottom: 0,
    opacity: 0.75,
  },
})

const controlsCss = css({
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  alignItems: 'center',
})

const buttonCss = css({
  padding: '5px 8px',
  border: '1px solid #71717a',
  borderRadius: 4,
  backgroundColor: 'white',
  color: '#18181b',
  font: 'inherit',
  cursor: 'pointer',
})

const rowsCss = css({
  maxHeight: 320,
  overflowY: 'auto',
  border: '1px solid #e4e4e7',
  borderRadius: 6,
  padding: 6,
  display: 'grid',
  gap: 4,
})

const rowCss = css({
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  padding: '4px 8px',
  border: '1px solid #e4e4e7',
  borderRadius: 4,
})

const badgeCss = css({
  padding: '1px 6px',
  borderRadius: 9999,
  backgroundColor: '#f4f4f5',
  fontVariantNumeric: 'tabular-nums',
})

const meterCss = css({
  fontVariantNumeric: 'tabular-nums',
  opacity: 0.75,
})

function seedCatalog() {
  let catalog = new Map<number, FilterItem>()
  for (let index = 0; index < filterItemCount; index++) {
    catalog.set(index, {
      id: index,
      name: `${palette[index % palette.length]}-widget-${((index * 37) % 900) + 100}`,
      rank: (index * 7919) % 10_000,
    })
  }
  return catalog
}

function orderedVisible(catalog: ReadonlyMap<number, FilterItem>, query: string, sort: SortKey) {
  let q = query.trim().toLowerCase()
  let ids: number[] = []
  for (let [id, item] of catalog) {
    if (item.name.includes(q) || String(item.rank).includes(q)) ids.push(id)
  }
  switch (sort) {
    case 'name':
      ids.sort((a, b) => catalog.get(a)!.name.localeCompare(catalog.get(b)!.name))
      break
    case 'nameDesc':
      ids.sort((a, b) => catalog.get(b)!.name.localeCompare(catalog.get(a)!.name))
      break
    case 'rank':
      ids.sort((a, b) => catalog.get(a)!.rank - catalog.get(b)!.rank)
      break
    case 'id':
      ids.sort((a, b) => a - b)
      break
  }
  return ids
}

function seedFeed() {
  let items = new Map<number, FeedItem>()
  for (let index = 0; index < 50; index++) {
    items.set(index, { id: index, label: `tick-${index}`, value: (index * 13) % 97 })
  }
  return items
}

const feedNouns = ['quote', 'trade', 'tick', 'ping', 'event', 'sample', 'frame', 'packet']

function seedHeavy() {
  let items = new Map<number, HeavyItem>()
  for (let index = 0; index < heavyCount; index++) {
    items.set(index, {
      id: index,
      title: `${feedNouns[index % feedNouns.length]}-${index}`,
      done: false,
      priority: (index % 5) + 1,
      edits: 0,
    })
  }
  return items
}

const heavyRowCss = css({
  display: 'grid',
  gridTemplateColumns: 'auto 1fr auto auto auto',
  gap: 8,
  alignItems: 'center',
  padding: '6px 8px',
  border: '1px solid #e4e4e7',
  borderRadius: 6,
  '& input': {
    accentColor: '#2563eb',
  },
  '& button': {
    font: 'inherit',
    fontSize: 12,
    padding: '2px 6px',
    border: '1px solid #a1a1aa',
    borderRadius: 4,
    backgroundColor: 'white',
    cursor: 'pointer',
  },
})

function installMeter<State extends { meter: number }>(
  store: { state: { update(recipe: (draft: Draft<State>) => undefined): void } },
  signal: AbortSignal,
) {
  let mutations = 0
  let observer: MutationObserver | null = null
  let interval = setInterval(() => {
    let count = mutations
    mutations = 0
    store.state.update((draft) => {
      draft.meter = count
    })
  }, 1000)
  signal.addEventListener('abort', () => {
    clearInterval(interval)
    observer?.disconnect()
  })
  return {
    observe(node: Element | null) {
      if (!node || observer) return
      observer = new MutationObserver(() => {
        mutations++
      })
      observer.observe(node, { childList: true, characterData: true, subtree: true })
    },
  }
}

type Timing = { eventedMs: number; eventedTicks: number; plainMs: number; plainTicks: number }

function emptyTiming(): Timing {
  return { eventedMs: 0, eventedTicks: 0, plainMs: 0, plainTicks: 0 }
}

function timingLabel(timing: Timing | null | undefined): string {
  if (!timing) return ''
  let evented = timing.eventedTicks > 0 ? timing.eventedMs / timing.eventedTicks : null
  let plain = timing.plainTicks > 0 ? timing.plainMs / timing.plainTicks : null
  let parts: string[] = []
  if (evented !== null) parts.push(`evented ${evented.toFixed(2)} ms/tick (${timing.eventedTicks})`)
  if (plain !== null) parts.push(`plain ${plain.toFixed(2)} ms/tick (${timing.plainTicks})`)
  if (evented !== null && plain !== null && plain > 0) {
    parts.push(`time saved ${Math.max(0, (1 - evented / plain) * 100).toFixed(0)}%`)
  }
  return parts.join(' · ')
}

function recordTiming<State extends { timing: Timing }>(
  store: { state: { update(recipe: (draft: Draft<State>) => undefined): void } },
  mode: 'evented' | 'plain',
  ms: number,
) {
  store.state.update((draft) => {
    if (mode === 'evented') {
      draft.timing.eventedMs += ms
      draft.timing.eventedTicks += 1
    } else {
      draft.timing.plainMs += ms
      draft.timing.plainTicks += 1
    }
  })
}

// Evented updates are applied by the scheduler on a microtask flush, so a
// commit settles after a few microtask hops. Overlapping ticks coalesce into
// one flush; the guard skips measuring them so their shared work is not
// double-counted.
function makeSettler() {
  let measuring = false
  return {
    async settleTick(): Promise<boolean> {
      if (measuring) return false
      measuring = true
      try {
        for (let index = 0; index < 8; index++) await Promise.resolve()
      } finally {
        measuring = false
      }
      return true
    },
  }
}

export const ListUpdatesFilterBoard = clientEntry(
  import.meta.url,
  function ListUpdatesFilterBoard(handle: Handle) {
    let store = customEvents<FilterBoardState>().store({
      catalog: seedCatalog(),
      visible: seedCatalog(),
      meter: 0,
      timing: emptyTiming(),
    })
    let mode: 'evented' | 'plain' = 'evented'
    let query = ''
    let sort: SortKey = 'id'
    let meter = installMeter(store, handle.signal)
    let settler = makeSettler()

    function commit(recipe: (draft: Draft<FilterBoardState>) => undefined) {
      store.state.update(recipe)
      if (mode === 'plain') return handle.update()
    }

    async function measureTick(recipe: (draft: Draft<FilterBoardState>) => undefined) {
      let t0 = performance.now()
      let pending = commit(recipe)
      if (pending) {
        await pending
      } else if (!(await settler.settleTick())) {
        return
      }
      recordTiming(store, mode, performance.now() - t0)
    }

    async function applyView(nextQuery: string, nextSort: SortKey) {
      query = nextQuery
      sort = nextSort
      let current = store.state.value
      let order = orderedVisible(current.catalog, query, sort)
      let currentKeys = [...current.visible.keys()]
      let sameOrder =
        currentKeys.length === order.length &&
        currentKeys.every((key, index) => key === order[index])
      if (sameOrder) return
      let currentSet = new Set(currentKeys)
      let orderSet = new Set(order)
      let additions = order.filter((id) => !currentSet.has(id))
      let removals = currentKeys.filter((id) => !orderSet.has(id))
      if (additions.length > 0 || removals.length === 0) {
        // New rows appeared (or a pure reorder): rebuild the whole map so sorted
        // positions land correctly; the list reconciles by key.
        await measureTick((draft) => {
          draft.visible = new Map(order.map((id) => [id, draft.catalog.get(id)!] as const))
        })
      } else {
        await measureTick((draft) => {
          for (let id of removals) draft.visible.delete(id)
        })
      }
    }

    function filterRow(item: FilterItem, key?: number): RemixNode {
      return (
        <div key={key} className="row" mix={rowCss}>
          <span>{item.name}</span>
          <span mix={badgeCss}>#{item.rank}</span>
        </div>
      )
    }

    return () => (
      <section className="filter-board" mix={cardCss}>
        <header>
          <h3>Per-keystroke filter and sort</h3>
          <p>
            {filterItemCount} widgets in a Map store. Typing removes rows that stop matching
            fine-grained (one DOM op per dropped row); widening the query or switching the sort
            rebuilds the visible map, and the keyed diff reorders the DOM without recreating rows.
            The plain re-render re-runs every row template on each keystroke. Average apply time per
            keystroke is tracked next to the DOM mutation meter.
          </p>
        </header>
        <div mix={controlsCss}>
          <input
            type="search"
            placeholder="Filter by name or rank…"
            mix={on('input', ({ currentTarget }) => applyView(currentTarget.value, sort))}
          />
          <select
            mix={on('change', ({ currentTarget }) =>
              applyView(query, currentTarget.value as SortKey),
            )}
          >
            <option value="id">By id</option>
            <option value="name">By name</option>
            <option value="nameDesc">By name (desc)</option>
            <option value="rank">By rank</option>
          </select>
          <button
            type="button"
            mix={[
              buttonCss,
              on('click', () => {
                mode = mode === 'evented' ? 'plain' : 'evented'
                handle.update()
              }),
            ]}
          >
            {mode === 'evented' ? 'Switch to plain re-render' : 'Switch to evented'}
          </button>
          <evented.output eventSource={store.events.visible} mix={meterCss}>
            {({ detail }) => (detail ? `${detail.size} shown` : '')}
          </evented.output>
          <evented.output eventSource={store.events.meter} mix={meterCss}>
            {({ detail }) => `DOM mutations/s: ${detail ?? 0}`}
          </evented.output>
          <evented.output eventSource={store.events.timing} mix={meterCss}>
            {({ detail }) => timingLabel(detail)}
          </evented.output>
        </div>
        <div className="filter-rows" mix={[rowsCss, ref((node) => meter.observe(node))]}>
          {mode === 'evented' ? (
            <evented.list eventSource={store.events.visible}>
              {(item, id) => filterRow(item, id)}
            </evented.list>
          ) : (
            store.state.value.visible
              .values()
              .map((item) => filterRow(item))
              .toArray()
          )}
        </div>
      </section>
    )
  },
)

export const ListUpdatesFeedBoard = clientEntry(
  import.meta.url,
  function ListUpdatesFeedBoard(handle: Handle) {
    let store = customEvents().store({ items: seedFeed(), meter: 0, timing: emptyTiming() })
    let mode: 'evented' | 'plain' = 'evented'
    let running = false
    let batch = 10
    let nextId = 50
    let ringStart = 0
    let meter = installMeter(store, handle.signal)
    let settler = makeSettler()

    function commit(recipe: (draft: Draft<FeedBoardState>) => undefined) {
      store.state.update(recipe)
      if (mode === 'plain') return handle.update()
    }

    async function measureTick(recipe: (draft: Draft<FeedBoardState>) => undefined) {
      let t0 = performance.now()
      let pending = commit(recipe)
      if (pending) {
        await pending
      } else if (!(await settler.settleTick())) {
        return
      }
      recordTiming(store, mode, performance.now() - t0)
    }

    async function feed() {
      await measureTick((draft) => {
        for (let index = 0; index < batch; index++) {
          let id = nextId++
          draft.items.set(id, {
            id,
            label: `${feedNouns[id % feedNouns.length]}-${id}`,
            value: (id * 7919) % 10_000,
          })
        }
        let excess = draft.items.size - feedCap
        for (let index = 0; index < excess; index++) {
          draft.items.delete(ringStart + index)
        }
        ringStart += excess
      })
    }

    let interval = setInterval(() => {
      if (running) feed()
    }, feedIntervalMs)
    handle.signal.addEventListener('abort', () => clearInterval(interval))

    function feedRow(item: FeedItem, key?: number): RemixNode {
      return (
        <div key={key} className="row" mix={rowCss}>
          <span>{item.label}</span>
          <span mix={badgeCss}>#{item.value}</span>
        </div>
      )
    }

    return () => (
      <section className="feed-board" mix={cardCss}>
        <header>
          <h3>High-frequency live feed</h3>
          <p>
            A burst of {batch} adds (plus the oldest drops to stay under {feedCap}) arrives every{' '}
            {feedIntervalMs} ms as one coalesced update. The evented list applies the burst as a
            handful of fine-grained DOM ops; the plain re-render rebuilds every row. Average apply
            time per burst is tracked next to the DOM mutation meter.
          </p>
        </header>
        <div mix={controlsCss}>
          <button
            type="button"
            mix={[
              buttonCss,
              on('click', () => {
                running = !running
                handle.update()
              }),
            ]}
          >
            {running ? 'Pause feed' : 'Start feed'}
          </button>
          <button type="button" mix={[buttonCss, on('click', feed)]}>
            Feed now
          </button>
          <label>
            {batch}/tick{' '}
            <input
              type="range"
              min={1}
              max={100}
              value={batch}
              mix={on('input', ({ currentTarget }) => {
                batch = currentTarget.valueAsNumber
                handle.update()
              })}
            />
          </label>
          <button
            type="button"
            mix={[
              buttonCss,
              on('click', () => {
                mode = mode === 'evented' ? 'plain' : 'evented'
                handle.update()
              }),
            ]}
          >
            {mode === 'evented' ? 'Switch to plain re-render' : 'Switch to evented'}
          </button>
          <evented.output eventSource={store.events.items} mix={meterCss}>
            {({ detail }) => (detail ? `${detail.size}/${feedCap}` : '')}
          </evented.output>
          <evented.output eventSource={store.events.meter} mix={meterCss}>
            {({ detail }) => `DOM mutations/s: ${detail ?? 0}`}
          </evented.output>
          <evented.output eventSource={store.events.timing} mix={meterCss}>
            {({ detail }) => timingLabel(detail)}
          </evented.output>
        </div>
        <div className="feed-rows" mix={[rowsCss, ref((node) => meter.observe(node))]}>
          {mode === 'evented' ? (
            <evented.list eventSource={store.events.items}>
              {(item, id) => feedRow(item, id)}
            </evented.list>
          ) : (
            store.state.value.items
              .values()
              .map((item) => feedRow(item))
              .toArray()
          )}
        </div>
      </section>
    )
  },
)

export const ListUpdatesHeavyBoard = clientEntry(
  import.meta.url,
  function ListUpdatesHeavyBoard(handle: Handle) {
    let store = customEvents<HeavyBoardState>().store({
      items: seedHeavy(),
      meter: 0,
      timing: emptyTiming(),
    })
    let mode: 'evented' | 'plain' = 'evented'
    let churning = false
    let churnPerTick = 20
    let meter = installMeter(store, handle.signal)
    let settler = makeSettler()

    function commit(recipe: (draft: Draft<HeavyBoardState>) => undefined) {
      store.state.update(recipe)
      if (mode === 'plain') return handle.update()
    }

    async function measureTick(recipe: (draft: Draft<HeavyBoardState>) => undefined) {
      let t0 = performance.now()
      let pending = commit(recipe)
      if (pending) {
        await pending
      } else if (!(await settler.settleTick())) {
        return
      }
      recordTiming(store, mode, performance.now() - t0)
    }

    async function churn() {
      let picked = new Set<number>()
      while (picked.size < churnPerTick) picked.add(Math.floor(Math.random() * heavyCount))
      await measureTick((draft) => {
        for (let id of picked) {
          let item = draft.items.get(id)
          if (item) item.priority = ((item.priority + 1) % 5) + 1
        }
      })
    }

    let interval = setInterval(() => {
      if (churning) void churn()
    }, churnIntervalMs)
    handle.signal.addEventListener('abort', () => clearInterval(interval))

    async function bumpAll() {
      await measureTick((draft) => {
        for (let item of draft.items.values()) {
          item.priority = ((item.priority + 1) % 5) + 1
        }
      })
    }

    function reset() {
      void measureTick((draft) => {
        draft.items = seedHeavy()
      })
    }

    function heavyRowContent(item: HeavyItem): RemixNode {
      return (
        <>
          <input
            type="checkbox"
            checked={item.done}
            aria-label={`toggle ${item.title}`}
            mix={on('change', () => {
              commit((draft) => {
                let row = draft.items.get(item.id)
                if (row) {
                  row.done = !row.done
                  row.edits += 1
                }
              })
            })}
          />
          <strong>{item.title}</strong>
          <output style={{ backgroundColor: priorityColors[item.priority - 1] }} mix={badgeCss}>
            P{item.priority}
          </output>
          <span>{item.edits} edits</span>
          <button
            type="button"
            mix={on('click', () => {
              commit((draft) => {
                let row = draft.items.get(item.id)
                if (row) row.edits += 1
              })
            })}
          >
            edit
          </button>
        </>
      )
    }

    return () => (
      <section className="heavy-board" mix={cardCss}>
        <header>
          <h3>Heavier items</h3>
          <p>
            {heavyCount} interactive rows (checkbox, priority badge, edit button). Churn bumps a
            random {churnPerTick}-row slice every {churnIntervalMs} ms: evented rows subscribe
            per-item, so only touched rows re-render, while the plain re-render re-runs and
            repatches all {heavyCount}. Toggle a checkbox to see a single row update fine-grained.
            Average apply time per tick is tracked next to the DOM mutation meter.
          </p>
        </header>
        <div mix={controlsCss}>
          <button
            type="button"
            mix={[
              buttonCss,
              on('click', () => {
                churning = !churning
                handle.update()
              }),
            ]}
          >
            {churning ? 'Stop churn' : 'Start churn'}
          </button>
          <label>
            {churnPerTick}/tick{' '}
            <input
              type="range"
              min={1}
              max={heavyCount}
              value={churnPerTick}
              mix={on('input', ({ currentTarget }) => {
                churnPerTick = currentTarget.valueAsNumber
                handle.update()
              })}
            />
          </label>
          <button type="button" mix={[buttonCss, on('click', bumpAll)]}>
            Bump all priorities
          </button>
          <button type="button" mix={[buttonCss, on('click', reset)]}>
            Reset
          </button>
          <button
            type="button"
            mix={[
              buttonCss,
              on('click', () => {
                mode = mode === 'evented' ? 'plain' : 'evented'
                handle.update()
              }),
            ]}
          >
            {mode === 'evented' ? 'Switch to plain re-render' : 'Switch to evented'}
          </button>
          <evented.output eventSource={store.events.meter} mix={meterCss}>
            {({ detail }) => `DOM mutations/s: ${detail ?? 0}`}
          </evented.output>
          <evented.output eventSource={store.events.timing} mix={meterCss}>
            {({ detail }) => timingLabel(detail)}
          </evented.output>
        </div>
        <div className="heavy-rows" mix={[rowsCss, ref((node) => meter.observe(node))]}>
          {mode === 'evented'
            ? store.state.value.items
                .values()
                .map((item) => (
                  <evented.article
                    key={item.id}
                    className="row"
                    eventSource={store.events.items.get(item.id)}
                    mix={heavyRowCss}
                  >
                    {({ detail }) => heavyRowContent(detail ?? item)}
                  </evented.article>
                ))
                .toArray()
            : store.state.value.items
                .values()
                .map((item) => (
                  <article key={item.id} className="row" mix={heavyRowCss}>
                    {heavyRowContent(item)}
                  </article>
                ))
                .toArray()}
        </div>
      </section>
    )
  },
)
