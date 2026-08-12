import { clientEntry, css, on, ref } from 'remix/ui'
import type { Handle, RemixNode } from 'remix/ui'
import { customEvents, evented } from '../utils/customEvents/index.tsx'

type FilterItem = { id: number; name: string; rank: number }
type SortKey = 'id' | 'name' | 'nameDesc' | 'rank'
type FeedItem = { id: number; label: string; value: number }
type HeavyItem = { id: number; title: string; done: boolean; priority: number; edits: number }

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

function installMeter(
  commit: (payload: Record<string, unknown>) => Promise<void>,
  signal: AbortSignal,
) {
  let mutations = 0
  let observer: MutationObserver | null = null
  let interval = setInterval(() => {
    let count = mutations
    mutations = 0
    void commit({ meter: count })
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

// Shared commit/measure machinery over a retained descriptor: `commit`
// dispatches a fold payload and, in plain mode, also schedules the board
// re-render; `measure` times one tick from commit until the DOM has settled;
// `resetTiming` clears the per-mode accumulators so a benchmark reads cleanly.
function makeWorkflow(options: {
  dispatch: (payload: Record<string, unknown>) => Promise<void>
  handle: Handle
  getMode: () => 'evented' | 'plain'
}) {
  async function commit(payload: Record<string, unknown>) {
    await options.dispatch(payload)
    if (options.getMode() === 'plain') {
      // Plain mode re-renders the whole rows subtree; a refresh event forces
      // it even when the dispatch's own routes are per-item (mapReplace).
      await options.dispatch({ refresh: null })
      await options.handle.update()
    }
  }
  async function measure(payload: Record<string, unknown>, record = true) {
    let t0 = performance.now()
    await commit(payload)
    if (record) {
      await options.dispatch({
        recordTiming: { mode: options.getMode(), ms: performance.now() - t0 },
      })
    }
  }
  function record(ms: number) {
    void options.dispatch({ recordTiming: { mode: options.getMode(), ms } })
  }
  function resetTiming() {
    void options.dispatch({ resetTiming: null })
  }
  return { commit, measure, resetTiming, record }
}

const benchmarkTicksPerMode = 30

// Benchmark ticks flush through the scheduler's microtask queue in a single
// turn; yielding to the event loop between ticks keeps the cascading-update
// guard (50 updates per turn) from tripping on a legitimate workload.
let yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

// Runs `tick` benchmarkTicksPerMode times in evented mode, then the same in
// plain mode, restoring the previous mode and any suspended activity
// afterwards. Timing accumulators are cleared first and one timing entry is
// recorded per tick (tick recipes pass record=false to the workflow measure)
// so the meters show the benchmark numbers only.
function makeBenchmarker(options: {
  workflow: ReturnType<typeof makeWorkflow>
  handle: Handle
  getMode: () => 'evented' | 'plain'
  setMode: (mode: 'evented' | 'plain') => void
  tick: () => Promise<void>
  suspend?: () => void
  restore?: () => void
}) {
  let { workflow, handle } = options
  let active = false
  return {
    get active() {
      return active
    },
    async run() {
      if (active) return
      active = true
      let previous = options.getMode()
      options.suspend?.()
      try {
        workflow.resetTiming()
        options.setMode('evented')
        await handle.update()
        for (let index = 0; index < benchmarkTicksPerMode; index++) {
          let t0 = performance.now()
          await options.tick()
          workflow.record(performance.now() - t0)
          await yieldToEventLoop()
        }
        options.setMode('plain')
        await handle.update()
        for (let index = 0; index < benchmarkTicksPerMode; index++) {
          let t0 = performance.now()
          await options.tick()
          workflow.record(performance.now() - t0)
          await yieldToEventLoop()
        }
      } finally {
        active = false
        options.restore?.()
        options.setMode(previous)
        await handle.update()
      }
    },
  }
}

export const ListUpdatesFilterBoard = clientEntry(
  import.meta.url,
  function ListUpdatesFilterBoard(handle: Handle) {
    let events = customEvents(
      {
        catalog: seedCatalog(),
        visible: seedCatalog(),
        meter: 0,
        timing: emptyTiming(),
      },
      {
        applyView: (draft, { query, sort }: { query: string; sort: SortKey }) => {
          let order = orderedVisible(draft.catalog, query, sort)
          let currentKeys = [...draft.visible.keys()]
          let sameOrder =
            currentKeys.length === order.length &&
            currentKeys.every((key, index) => key === order[index])
          if (sameOrder) return
          let currentSet = new Set(currentKeys)
          let orderSet = new Set(order)
          let additions = order.filter((id) => !currentSet.has(id))
          let removals = currentKeys.filter((id) => !orderSet.has(id))
          if (additions.length > 0 || removals.length === 0) {
            // New rows appeared (or a pure reorder): rebuild the whole map so
            // sorted positions land correctly; the list reconciles by key.
            draft.visible = new Map(order.map((id) => [id, draft.catalog.get(id)!] as const))
            return
          }
          for (let id of removals) draft.visible.delete(id)
        },
        tickWide: (draft) => {
          draft.visible = new Map(
            orderedVisible(draft.catalog, 'crimson', 'id').map(
              (id) => [id, draft.catalog.get(id)!] as const,
            ),
          )
        },
        tickKeep: (draft) => {
          let keep = new Set(orderedVisible(draft.catalog, 'crimson-widget-500', 'id'))
          for (let id of [...draft.visible.keys()]) {
            if (!keep.has(id)) draft.visible.delete(id)
          }
        },
        resetVisible: (draft) => {
          draft.visible = new Map(draft.catalog)
        },
        meterTick: (draft, count: number) => {
          draft.meter = count
        },
        recordTiming: (draft, { mode, ms }: { mode: 'evented' | 'plain'; ms: number }) => {
          if (mode === 'evented') {
            draft.timing.eventedMs += ms
            draft.timing.eventedTicks += 1
          } else {
            draft.timing.plainMs += ms
            draft.timing.plainTicks += 1
          }
        },
        resetTiming: (draft) => {
          draft.timing = emptyTiming()
        },
        refresh: () => {},
      },
    )
    let mode: 'evented' | 'plain' = 'evented'
    let query = ''
    let sort: SortKey = 'id'
    let commit = (payload: Record<string, unknown>) => events.dispatchEvent(payload)
    let meter = installMeter(commit, handle.signal)
    let workflow = makeWorkflow({ dispatch: commit, handle, getMode: () => mode })
    let benchmarker = makeBenchmarker({
      workflow,
      handle,
      getMode: () => mode,
      setMode: (next) => {
        mode = next
      },
      tick: async () => {
        await workflow.measure({ tickWide: null }, false)
        await workflow.measure({ tickKeep: null }, false)
      },
    })

    async function benchmark() {
      await benchmarker.run()
      query = ''
      await workflow.commit({ resetVisible: null })
      await handle.update()
    }

    async function applyView(nextQuery: string, nextSort: SortKey) {
      query = nextQuery
      sort = nextSort
      await workflow.measure({ applyView: { query, sort } })
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
            keystroke is tracked next to the DOM mutation meter; the benchmark button runs 30 ticks
            per mode automatically.
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
          <button
            type="button"
            mix={[buttonCss, on('click', () => void benchmark())]}
            disabled={benchmarker.active}
          >
            {benchmarker.active ? 'Benchmarking…' : `Benchmark ${benchmarkTicksPerMode} ticks/mode`}
          </button>
          <evented.output eventSource={events.visible} mix={meterCss}>
            {(rows) => (rows ? `${rows.size} shown` : '')}
          </evented.output>
          <evented.output eventSource={events.meter} mix={meterCss}>
            {(mutations) => `DOM mutations/s: ${mutations ?? 0}`}
          </evented.output>
          <evented.output eventSource={events.timing} mix={meterCss}>
            {(timing) => timingLabel(timing)}
          </evented.output>
        </div>
        <div className="filter-rows" mix={[rowsCss, ref((node) => meter.observe(node))]}>
          {mode === 'evented' ? (
            <evented.list key="evented" eventSource={events.visible}>
              {(item, id) => filterRow(item, id)}
            </evented.list>
          ) : (
            <evented.div key="plain" eventSource={[events.visible, events.refresh]}>
              {([visible]) =>
                visible
                  .values()
                  .map((item) => filterRow(item))
                  .toArray()
              }
            </evented.div>
          )}
        </div>
      </section>
    )
  },
)

export const ListUpdatesFeedBoard = clientEntry(
  import.meta.url,
  function ListUpdatesFeedBoard(handle: Handle) {
    let events = customEvents(
      {
        items: seedFeed(),
        meter: 0,
        timing: emptyTiming(),
        nextId: 50,
        ringStart: 0,
      },
      {
        feed: (draft) => {
          for (let index = 0; index < batch; index++) {
            let id = draft.nextId++
            draft.items.set(id, {
              id,
              label: `${feedNouns[id % feedNouns.length]}-${id}`,
              value: (id * 7919) % 10_000,
            })
          }
          let excess = draft.items.size - feedCap
          for (let index = 0; index < excess; index++) {
            draft.items.delete(draft.ringStart + index)
          }
          draft.ringStart += excess
        },
        meterTick: (draft, count: number) => {
          draft.meter = count
        },
        recordTiming: (draft, { mode, ms }: { mode: 'evented' | 'plain'; ms: number }) => {
          if (mode === 'evented') {
            draft.timing.eventedMs += ms
            draft.timing.eventedTicks += 1
          } else {
            draft.timing.plainMs += ms
            draft.timing.plainTicks += 1
          }
        },
        resetTiming: (draft) => {
          draft.timing = emptyTiming()
        },
        refresh: () => {},
      },
    )
    let mode: 'evented' | 'plain' = 'evented'
    let running = false
    let batch = 10
    let commit = (payload: Record<string, unknown>) => events.dispatchEvent(payload)
    let meter = installMeter(commit, handle.signal)
    let workflow = makeWorkflow({ dispatch: commit, handle, getMode: () => mode })

    let wasRunning: boolean | undefined
    let benchmarker = makeBenchmarker({
      workflow,
      handle,
      getMode: () => mode,
      setMode: (next) => {
        mode = next
      },
      suspend: () => {
        wasRunning = running
        running = false
      },
      restore: () => {
        if (wasRunning !== undefined) running = wasRunning
      },
      tick: async () => {
        await workflow.measure({ feed: null }, false)
      },
    })

    function feed() {
      void workflow.measure({ feed: null })
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
            time per burst is tracked next to the DOM mutation meter; the benchmark button runs 30
            bursts per mode automatically.
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
          <button
            type="button"
            mix={[buttonCss, on('click', () => void benchmarker.run())]}
            disabled={benchmarker.active}
          >
            {benchmarker.active ? 'Benchmarking…' : `Benchmark ${benchmarkTicksPerMode} ticks/mode`}
          </button>
          <evented.output eventSource={events.items} mix={meterCss}>
            {(items) => (items ? `${items.size}/${feedCap}` : '')}
          </evented.output>
          <evented.output eventSource={events.meter} mix={meterCss}>
            {(mutations) => `DOM mutations/s: ${mutations ?? 0}`}
          </evented.output>
          <evented.output eventSource={events.timing} mix={meterCss}>
            {(timing) => timingLabel(timing)}
          </evented.output>
        </div>
        <div className="feed-rows" mix={[rowsCss, ref((node) => meter.observe(node))]}>
          {mode === 'evented' ? (
            <evented.list key="evented" eventSource={events.items}>
              {(item, id) => feedRow(item, id)}
            </evented.list>
          ) : (
            <evented.div key="plain" eventSource={[events.items, events.refresh]}>
              {([items]) =>
                items
                  .values()
                  .map((item) => feedRow(item))
                  .toArray()
              }
            </evented.div>
          )}
        </div>
      </section>
    )
  },
)

export const ListUpdatesHeavyBoard = clientEntry(
  import.meta.url,
  function ListUpdatesHeavyBoard(handle: Handle) {
    let events = customEvents(
      {
        items: seedHeavy(),
        meter: 0,
        timing: emptyTiming(),
      },
      {
        toggleRow: (draft, id: number) => {
          let row = draft.items.get(id)
          if (!row) return
          row.done = !row.done
          row.edits += 1
        },
        editRow: (draft, id: number) => {
          let row = draft.items.get(id)
          if (row) row.edits += 1
        },
        churn: (draft, picked: ReadonlySet<number>) => {
          for (let id of picked) {
            let item = draft.items.get(id)
            if (item) item.priority = ((item.priority + 1) % 5) + 1
          }
        },
        bumpAll: (draft) => {
          for (let item of draft.items.values()) {
            item.priority = ((item.priority + 1) % 5) + 1
          }
        },
        resetItems: (draft) => {
          draft.items = seedHeavy()
        },
        meterTick: (draft, count: number) => {
          draft.meter = count
        },
        recordTiming: (draft, { mode, ms }: { mode: 'evented' | 'plain'; ms: number }) => {
          if (mode === 'evented') {
            draft.timing.eventedMs += ms
            draft.timing.eventedTicks += 1
          } else {
            draft.timing.plainMs += ms
            draft.timing.plainTicks += 1
          }
        },
        resetTiming: (draft) => {
          draft.timing = emptyTiming()
        },
        refresh: () => {},
      },
    )
    let mode: 'evented' | 'plain' = 'evented'
    let churning = false
    let churnPerTick = 20
    let commit = (payload: Record<string, unknown>) => events.dispatchEvent(payload)
    let meter = installMeter(commit, handle.signal)
    let workflow = makeWorkflow({ dispatch: commit, handle, getMode: () => mode })

    function pickChurn() {
      let picked = new Set<number>()
      while (picked.size < churnPerTick) picked.add(Math.floor(Math.random() * heavyCount))
      return picked
    }

    let wasChurning: boolean | undefined
    let benchmarker = makeBenchmarker({
      workflow,
      handle,
      getMode: () => mode,
      setMode: (next) => {
        mode = next
      },
      suspend: () => {
        wasChurning = churning
        churning = false
      },
      restore: () => {
        if (wasChurning !== undefined) churning = wasChurning
      },
      tick: async () => {
        await workflow.measure({ churn: pickChurn() }, false)
      },
    })

    function churn() {
      void workflow.measure({ churn: pickChurn() })
    }

    let interval = setInterval(() => {
      if (churning) churn()
    }, churnIntervalMs)
    handle.signal.addEventListener('abort', () => clearInterval(interval))

    function bumpAll() {
      void workflow.measure({ bumpAll: null })
    }

    function reset() {
      void workflow.measure({ resetItems: null })
    }

    function heavyRowContent(item: HeavyItem): RemixNode {
      return (
        <>
          <input
            type="checkbox"
            checked={item.done}
            aria-label={`toggle ${item.title}`}
            mix={on('change', () => {
              void workflow.commit({ toggleRow: item.id })
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
              void workflow.commit({ editRow: item.id })
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
            Average apply time per tick is tracked next to the DOM mutation meter; the benchmark
            button runs 30 ticks per mode automatically.
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
          <button
            type="button"
            mix={[buttonCss, on('click', () => void benchmarker.run())]}
            disabled={benchmarker.active}
          >
            {benchmarker.active ? 'Benchmarking…' : `Benchmark ${benchmarkTicksPerMode} ticks/mode`}
          </button>
          <evented.output eventSource={events.meter} mix={meterCss}>
            {(mutations) => `DOM mutations/s: ${mutations ?? 0}`}
          </evented.output>
          <evented.output eventSource={events.timing} mix={meterCss}>
            {(timing) => timingLabel(timing)}
          </evented.output>
        </div>
        <div className="heavy-rows" mix={[rowsCss, ref((node) => meter.observe(node))]}>
          {mode === 'evented' ? (
            <evented.div key="evented" eventSource={events.items}>
              {(items) =>
                items
                  .values()
                  .map((item) => (
                    <evented.article
                      key={item.id}
                      className="row"
                      eventSource={events.items.get(item.id)}
                      mix={heavyRowCss}
                    >
                      {(row) => heavyRowContent(row ?? item)}
                    </evented.article>
                  ))
                  .toArray()
              }
            </evented.div>
          ) : (
            <evented.div key="plain" eventSource={[events.items, events.refresh]}>
              {([items]) =>
                items
                  .values()
                  .map((item) => (
                    <article key={item.id} className="row" mix={heavyRowCss}>
                      {heavyRowContent(item)}
                    </article>
                  ))
                  .toArray()
              }
            </evented.div>
          )}
        </div>
      </section>
    )
  },
)
