import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { on, ref } from 'remix/ui'
import { render } from 'remix/ui/test'
import { customEvents } from './index.tsx'
import { createCustomEventsRuntimeState, customEventsRuntime } from './runtime.ts'
import type { CustomEventsOptions } from './types.ts'

type TestEvents = {
  submitted: { id: string }
  paid: null
  focusRequested: null
}

function createEvents(options?: CustomEventsOptions) {
  return customEvents<TestEvents>(options)
}

async function settleEffects() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('customEvents', () => {
  it('publishes store properties as typed events', () => {
    let store = customEvents().store({
      count: 0,
      label: 'idle',
    })
    let received: Array<[string, unknown]> = []

    store.host.addEventListener('count', (event) => {
      received.push([event.type, event.detail])
    })
    store.host.addEventListener('label', (event) => {
      received.push([event.type, event.detail])
    })

    store.state.update((draft) => {
      draft.count = 1
      draft.label = 'ready'
    })

    assert.equal(store.state.value.count, 1)
    assert.equal(store.state.value.label, 'ready')
    assert.deepEqual(received, [
      ['count', 1],
      ['label', 'ready'],
    ])

    if (false) {
      let nested = customEvents<{
        profile: { name: string }
        tags: string[]
      }>().store({ profile: { name: 'Ada' }, tags: [] })
      // @ts-expect-error - state is readable only through the state snapshot.
      store.count
      // @ts-expect-error - nested state changes only through update().
      nested.state.value.profile.name = 'Grace'
      // @ts-expect-error - collection state changes only through update().
      nested.state.value.tags.push('compiler')
      nested.host.addEventListener('profile', (event) => {
        // @ts-expect-error - published state details are immutable.
        event.detail.name = 'Grace'
      })
      // @ts-expect-error - update recipes must be synchronous.
      store.state.update(async (draft) => {
        draft.count = 2
      })
      // @ts-expect-error - update recipes return no value.
      store.state.update((draft) => draft.count++)
      // State keys live in the state.value envelope, so store API names are
      // usable as data keys.
      let relaxed = customEvents().store({
        events: 'collision',
        update: 'collision',
        value: 'collision',
        state: 'collision',
        host: 'collision',
      })
      relaxed.state.value.update
      relaxed.events.update
      // @ts-expect-error - update addresses are scoped to event-element on().
      store.updates
      // @ts-expect-error - state property events cannot use native DOM names.
      customEvents().store({ click: false })
      // @ts-expect-error - store() state keys cannot overwrite its API.
      customEvents<{ count: number }>().store({ count: 0, view: true })
      // @ts-expect-error - store is reserved as a descriptor method name.
      customEvents<{ store: string }>()
    }
  })

  it('freezes retained initial state references', () => {
    let initial = {
      profile: { name: 'Ada' },
      tags: ['compiler'],
    }
    let store = customEvents<typeof initial>().store(initial)

    assert.throws(() => {
      initial.profile.name = 'Grace'
    })
    assert.throws(() => {
      initial.tags.push('navy')
    })
    assert.equal(store.state.value.profile.name, 'Ada')
    assert.deepEqual(store.state.value.tags, ['compiler'])
  })

  it('keeps a destructured state live through updates', () => {
    let { state, view, events } = customEvents().store({
      count: 0,
      label: 'idle',
    })

    assert.equal(state.value.count, 0)
    assert.equal(state.value.label, 'idle')

    state.update((draft) => {
      draft.count = 1
      draft.label = 'ready'
    })

    assert.equal(state.value.count, 1)
    assert.equal(state.value.label, 'ready')

    assert.throws(() => {
      // @ts-expect-error - the snapshot is immutable.
      state.value.count = 99
    })
  })

  it('derives state events from nested Immer updates', () => {
    let store = customEvents().store({
      draft: { name: 'Grace', surname: 'Hopper' },
      people: [{ id: 1, name: 'Grace' }],
    })
    let originalDraft = store.state.value.draft
    let originalPeople = store.state.value.people
    let received: Array<[string, unknown]> = []

    store.host.addEventListener('draft', (event) => {
      received.push([event.type, event.detail])
      assert.equal(store.state.value.people[0]?.name, 'Ada')
    })
    store.host.addEventListener('people', (event) => {
      received.push([event.type, event.detail])
      assert.equal(store.state.value.draft.name, 'Ada')
    })

    store.state.update((draft) => {
      draft.draft.name = 'Ada'
      draft.people[0]!.name = 'Ada'
    })

    assert.equal(originalDraft.name, 'Grace')
    assert.equal(originalPeople[0]?.name, 'Grace')
    assert.equal(store.state.value.draft.name, 'Ada')
    assert.equal(store.state.value.people[0]?.name, 'Ada')
    assert.equal(received.length, 2)
    assert.equal(received.find(([type]) => type === 'draft')?.[1], store.state.value.draft)
    assert.equal(received.find(([type]) => type === 'people')?.[1], store.state.value.people)

    store.state.update((draft) => {
      draft.draft.name = 'Ada'
    })
    assert.equal(received.length, 2)

    assert.throws(() => {
      store.state.update((draft) => {
        draft.draft.name = 'discarded'
        throw new Error('stop')
      })
    }, /stop/)
    assert.equal(store.state.value.draft.name, 'Ada')
    assert.equal(received.length, 2)

    if (false) {
      store.state.update((draft) => {
        // @ts-expect-error - occurrences and undeclared properties are absent.
        draft.missing = true
      })
    }
  })

  it('infers nested update details and ignores unrelated paths', async (t) => {
    let store = customEvents().store({
      profile: { name: 'Ada', address: { city: 'London' } },
      status: 'idle',
    })
    let renders = 0

    function Profile() {
      return () => (
        <store.view.output
          aria-label="name"
          on={store.events.profile.name}
          class={({ detail }) => detail.toLowerCase()}
        >
          {({ detail }) => {
            detail satisfies string
            if (false) {
              // @ts-expect-error - detail is the selected value, not the snapshot.
              detail.toFixed()
            }
            renders++
            return detail
          }}
        </store.view.output>
      )
    }

    let result = render(<Profile />)
    t.after(() => result.cleanup())
    assert.equal(renders, 1)

    await result.act(async () => {
      store.state.update((draft) => {
        draft.status = 'ready'
      })
      await settleEffects()
    })
    assert.equal(renders, 1)

    await result.act(async () => {
      store.state.update((draft) => {
        draft.profile.name = 'Grace'
      })
      await settleEffects()
    })
    assert.equal(renders, 2)
    assert.equal(result.$('[aria-label="name"]')?.textContent, 'Grace')

    await result.act(async () => {
      store.state.update((draft) => {
        draft.profile.address.city = 'Arlington'
      })
      await settleEffects()
    })
    assert.equal(renders, 2)

    await result.act(async () => {
      store.state.update((draft) => {
        draft.profile = {
          name: 'Katherine',
          address: { city: 'Cleveland' },
        }
      })
      await settleEffects()
    })
    assert.equal(renders, 3)
    assert.equal(result.$('[aria-label="name"]')?.textContent, 'Katherine')
  })

  it('derives keyed routes from Map and primitive Set patches', async (t) => {
    let store = customEvents().store({
      position: new Map([
        ['a', 'X'],
        ['b', 'O'],
      ]),
      selected: new Set(['red']),
    })
    let calls = { mapA: 0, mapB: 0, mapAll: 0, red: 0, blue: 0 }
    let positionEvents = 0
    store.host.addEventListener('position', () => positionEvents++)

    function Collections() {
      return () => (
        <section>
          <store.view.output on={store.events.position.get('a')}>
            {({ detail }) => `${++calls.mapA}:${detail ?? ''}`}
          </store.view.output>
          <store.view.output on={store.events.position.get('b')}>
            {({ detail }) => `${++calls.mapB}:${detail ?? ''}`}
          </store.view.output>
          <store.view.output on={store.events.position}>
            {({ detail }) => `${++calls.mapAll}:${detail.size}`}
          </store.view.output>
          <store.view.output on={store.events.selected.has('red')}>
            {({ detail }) => `${++calls.red}:${detail}`}
          </store.view.output>
          <store.view.output on={store.events.selected.has('blue')}>
            {({ detail }) => `${++calls.blue}:${detail}`}
          </store.view.output>
        </section>
      )
    }

    let result = render(<Collections />)
    t.after(() => result.cleanup())

    await result.act(async () => {
      store.state.update((draft) => {
        draft.position.set('a', 'A')
      })
      await settleEffects()
    })
    assert.deepEqual(calls, {
      mapA: 2,
      mapB: 1,
      mapAll: 2,
      red: 1,
      blue: 1,
    })
    assert.equal(positionEvents, 1)

    await result.act(async () => {
      store.state.update((draft) => {
        draft.position.set('a', 'AA')
        draft.position.set('b', 'BB')
        draft.selected.add('blue')
      })
      await settleEffects()
    })
    assert.deepEqual(calls, {
      mapA: 3,
      mapB: 2,
      mapAll: 3,
      red: 1,
      blue: 2,
    })
    assert.equal(positionEvents, 2)
  })

  it('routes deep patches through every nested identity boundary', async (t) => {
    let store = customEvents().store({
      columns: new Map([
        [
          'column:todo',
          {
            cards: new Map([
              ['card:one', { urgent: false }],
              ['card:two', { urgent: false }],
            ]),
          },
        ],
        [
          'column:done',
          {
            cards: new Map([['card:three', { urgent: false }]]),
          },
        ],
      ]),
    })
    let calls = { todo: 0, done: 0, one: 0, two: 0, three: 0 }

    function Board() {
      return () => (
        <section>
          <store.view.output on={store.events.columns.get('column:todo')}>
            {() => String(++calls.todo)}
          </store.view.output>
          <store.view.output on={store.events.columns.get('column:done')}>
            {() => String(++calls.done)}
          </store.view.output>
          <store.view.output on={store.events.columns.get('column:todo').cards.get('card:one')}>
            {() => String(++calls.one)}
          </store.view.output>
          <store.view.output on={store.events.columns.get('column:todo').cards.get('card:two')}>
            {() => String(++calls.two)}
          </store.view.output>
          <store.view.output on={store.events.columns.get('column:done').cards.get('card:three')}>
            {() => String(++calls.three)}
          </store.view.output>
        </section>
      )
    }

    let result = render(<Board />)
    t.after(() => result.cleanup())

    await result.act(async () => {
      store.state.update((draft) => {
        draft.columns.get('column:todo')!.cards.get('card:one')!.urgent = true
      })
      await settleEffects()
    })

    assert.deepEqual(calls, {
      todo: 2,
      done: 1,
      one: 2,
      two: 1,
      three: 1,
    })
  })

  it('preserves object identity in Map update addresses', async (t) => {
    let recordKey = {}
    let store = customEvents<{
      records: Map<object, { value: number }>
    }>().store({
      records: new Map([[recordKey, { value: 1 }]]),
    })
    let renders = 0

    function RecordValue() {
      return () => (
        <store.view.output on={store.events.records.get(recordKey).value}>
          {({ detail }) => `${++renders}:${detail}`}
        </store.view.output>
      )
    }

    let result = render(<RecordValue />)
    t.after(() => result.cleanup())

    await result.act(async () => {
      store.state.update((draft) => {
        draft.records.get(recordKey)!.value = 2
      })
      await settleEffects()
    })

    assert.equal(renders, 2)
    assert.equal(result.$('output')?.textContent, '2:2')
  })

  it('derives array index routes by default', async (t) => {
    let store = customEvents().store({
      items: ['first', 'second'],
    })
    let calls = { first: 0, second: 0, all: 0 }

    function Items() {
      return () => (
        <section>
          <store.view.output on={store.events.items[0]}>
            {() => String(++calls.first)}
          </store.view.output>
          <store.view.output on={store.events.items[1]} aria-label="1">
            {() => String(++calls.second)}
          </store.view.output>
          <store.view.output on={store.events.items}>{() => String(++calls.all)}</store.view.output>
        </section>
      )
    }

    let result = render(<Items />)
    t.after(() => result.cleanup())

    await result.act(async () => {
      store.state.update((draft) => {
        draft.items[1] = 'updated'
      })
      await settleEffects()
    })
    assert.deepEqual(calls, { first: 1, second: 2, all: 2 })

    await result.act(async () => {
      store.state.update((draft) => {
        draft.items.splice(0, 1)
      })
      await settleEffects()
    })
    assert.deepEqual(calls, { first: 2, second: 3, all: 3 })

    await result.act(async () => {
      store.state.update((draft) => {
        draft.items = ['replacement']
      })
      await settleEffects()
    })
    assert.deepEqual(calls, { first: 3, second: 4, all: 4 })
  })

  it('routes object arrays by index', async (t) => {
    type Circle = { id: number; diameter: number }
    let store = customEvents().store({
      circles: [
        { id: 7, diameter: 30 },
        { id: 8, diameter: 40 },
      ],
      values: { A0: '10', B0: '20' },
    })
    let calls = { circle0: 0, circle1: 0, A0: 0, B0: 0 }

    function Collections() {
      return () => (
        <section>
          <store.view.output on={store.events.circles[0]}>
            {() => String(++calls.circle0)}
          </store.view.output>
          <store.view.output on={store.events.circles[1]} aria-label="1">
            {() => String(++calls.circle1)}
          </store.view.output>
          <store.view.output on={store.events.values.A0}>
            {() => String(++calls.A0)}
          </store.view.output>
          <store.view.output on={store.events.values.B0}>
            {() => String(++calls.B0)}
          </store.view.output>
        </section>
      )
    }

    let result = render(<Collections />)
    t.after(() => result.cleanup())

    await result.act(async () => {
      store.state.update((draft) => {
        draft.circles[0]!.diameter = 35
        draft.values.A0 = '11'
      })
      await settleEffects()
    })
    assert.deepEqual(calls, { circle0: 2, circle1: 1, A0: 2, B0: 1 })

    await result.act(async () => {
      store.state.update((draft) => {
        draft.circles.splice(0, 1)
      })
      await settleEffects()
    })
    assert.deepEqual(calls, { circle0: 3, circle1: 2, A0: 2, B0: 1 })

    await result.act(async () => {
      store.state.update((draft) => {
        draft.circles = [
          { id: 7, diameter: 50 },
          {
            id: 8,
            diameter: 60,
          },
        ]
      })
      await settleEffects()
    })
    assert.deepEqual(calls, { circle0: 4, circle1: 3, A0: 2, B0: 1 })
  })

  it('routes scalar identity values by value and notifies owners via as()', async (t) => {
    let store = customEvents<{ selected: string | null }>().store({
      selected: null,
    })
    let calls = { first: 0, second: 0, all: 0 }
    let effectOrder: string[] = []

    function Selection() {
      return () => (
        <section>
          <store.view.button
            on={store.events.selected.as('1')}
            aria-label="1"
            type="button"
            aria-pressed={({ detail }) => detail}
            mix={store.events.selected.as('1').on(({ currentTarget, detail }) => {
              effectOrder.push(currentTarget.getAttribute('aria-label') ?? '')
              if (detail === '1') {
                currentTarget.focus()
              }
            })}
          >
            {() => String(++calls.first)}
          </store.view.button>
          <store.view.button
            on={store.events.selected.as('2')}
            aria-label="2"
            type="button"
            aria-pressed={({ detail }) => detail}
            mix={store.events.selected.as('2').on(({ currentTarget, detail }) => {
              effectOrder.push(currentTarget.getAttribute('aria-label') ?? '')
              if (detail === '2') {
                currentTarget.focus()
              }
            })}
          >
            {() => String(++calls.second)}
          </store.view.button>
          <store.view.output on={store.events.selected}>
            {() => String(++calls.all)}
          </store.view.output>
        </section>
      )
    }

    let result = render(<Selection />)
    t.after(() => result.cleanup())

    await result.act(async () => {
      store.state.update((draft) => {
        draft.selected = '1'
      })
      await settleEffects()
    })
    assert.deepEqual(calls, { first: 2, second: 1, all: 2 })
    assert.deepEqual(effectOrder, ['1'])
    assert.equal(document.activeElement?.getAttribute('aria-label'), '1')

    effectOrder.length = 0
    await result.act(async () => {
      store.state.update((draft) => {
        draft.selected = '2'
      })
      await settleEffects()
    })
    assert.deepEqual(calls, { first: 3, second: 2, all: 3 })
    assert.deepEqual(effectOrder, ['1', '2'])
    assert.equal(document.activeElement?.getAttribute('aria-label'), '2')
    assert.equal(
      (result.$('[aria-label="1"]') as HTMLButtonElement).getAttribute('aria-pressed'),
      'false',
    )
    assert.equal(
      (result.$('[aria-label="2"]') as HTMLButtonElement).getAttribute('aria-pressed'),
      'true',
    )

    await result.act(async () => {
      store.state.update((draft) => {
        draft.selected = null
      })
      await settleEffects()
    })
    assert.deepEqual(calls, { first: 3, second: 3, all: 4 })
    assert.equal(
      (result.$('[aria-label="2"]') as HTMLButtonElement).getAttribute('aria-pressed'),
      'false',
    )
  })

  it('derives occurrences from event-map entries omitted by the store value', () => {
    type State = { count: number }
    type Occurrences = { refreshRequested: null; countDrafted: number }
    let store = customEvents<State & Occurrences>().store({ count: 0 })
    let received: Array<[string, unknown]> = []

    store.host.addEventListener('count', (event) => {
      received.push([event.type, event.detail])
    })
    store.host.addEventListener('countDrafted', (event) => {
      received.push([event.type, event.detail])
    })
    store.host.addEventListener('refreshRequested', (event) => {
      received.push([event.type, event.detail])
    })

    store.state.update((draft) => {
      draft.count = 1
    })
    store.host.dispatchEvent(store.events.create('countDrafted', 2))
    store.host.dispatchEvent(store.events.create('refreshRequested'))

    assert.equal(store.state.value.count, 1)
    assert.deepEqual(received, [
      ['count', 1],
      ['countDrafted', 2],
      ['refreshRequested', null],
    ])

    store.host.dispatchEvent(store.events.create('count', 2))
    assert.equal(store.state.value.count, 2)
    assert.deepEqual(received[3], ['count', 2])

    if (false) {
      store.state.update((draft) => {
        // @ts-expect-error - occurrences are not state properties.
        draft.countDrafted = 2
      })
      // @ts-expect-error - occurrences do not become readable store.
      store.countDrafted
      // @ts-expect-error - occurrences cannot use native DOM event names.
      customEvents<State & { click: null }>().store({ count: 0 })
    }
  })

  it('combines state and occurrence event sources', async (t) => {
    let store = customEvents<{
      count: number
      countDrafted: number
    }>().store({ count: 0 })
    let renders = 0

    function Count() {
      return () => (
        <store.view.output on={[store.events.count, store.events.countDrafted]}>
          {({ detail: [count, draft] }) => `${draft ?? count}:${++renders}`}
        </store.view.output>
      )
    }

    let result = render(<Count />)
    t.after(() => result.cleanup())
    assert.equal(result.$('output')?.textContent, '0:1')

    await result.act(async () => {
      store.host.dispatchEvent(store.events.create('countDrafted', 2))
      await settleEffects()
    })
    assert.equal(result.$('output')?.textContent, '2:2')
  })

  it('keeps element-dispatched occurrences on the origin element', async (t) => {
    let store = customEvents<{
      count: number
      countDrafted: number
    }>().store({ count: 0 })
    let drafts = 0
    let listenerRenders = 0

    function Editor() {
      return () => (
        <section>
          <button
            aria-label="source"
            mix={[
              store.events.countDrafted.on(() => {
                drafts++
              }),
              on('click', ({ currentTarget }) => {
                currentTarget.dispatchEvent(store.events.create('countDrafted', 1))
              }),
            ]}
          />
          <store.view.output aria-label="listener" on={store.events.countDrafted}>
            {({ detail }) => (detail === undefined ? 'idle' : `${detail}:${++listenerRenders}`)}
          </store.view.output>
        </section>
      )
    }

    let result = render(<Editor />)
    t.after(() => result.cleanup())
    let source = result.$('[aria-label="source"]') as HTMLButtonElement
    let listener = result.$('[aria-label="listener"]') as HTMLOutputElement

    await result.act(() => source.click())
    await settleEffects()
    assert.equal(drafts, 1)
    assert.equal(listener.textContent, 'idle')

    await result.act(async () => {
      store.host.dispatchEvent(store.events.create('countDrafted', 2))
      await settleEffects()
    })
    assert.equal(listenerRenders, 1)
    assert.equal(listener.textContent, '2:1')
  })

  it('renders the whole state snapshot when on is omitted', async (t) => {
    let store = customEvents<{
      count: number
      countDrafted: number
    }>().store({ count: 0 })
    let seen: unknown[] = []

    function Snapshot() {
      return () => (
        <store.view.output aria-label="snapshot">
          {({ detail }) => {
            seen.push(detail)
            if (false) {
              detail satisfies number | { readonly count: number }
            }
            return typeof detail === 'object' && detail !== null
              ? `count:${detail.count}`
              : `raw:${detail}`
          }}
        </store.view.output>
      )
    }

    let result = render(<Snapshot />)
    t.after(() => result.cleanup())

    assert.equal(result.$('[aria-label="snapshot"]')?.textContent, 'count:0')
    assert.deepEqual(seen[0], { count: 0 })

    await result.act(async () => {
      store.state.update((draft) => {
        draft.count = 1
      })
      await settleEffects()
    })
    assert.equal(result.$('[aria-label="snapshot"]')?.textContent, 'count:1')
    assert.deepEqual(seen[seen.length - 1], { count: 1 })

    await result.act(async () => {
      store.host.dispatchEvent(store.events.create('countDrafted', 2))
      await settleEffects()
    })
    assert.equal(result.$('[aria-label="snapshot"]')?.textContent, 'raw:2')
    assert.equal(seen[seen.length - 1], 2)
  })

  it('creates an independent EventTarget host for each state model', () => {
    let models = customEvents<{ count: number }>()
    let first = models.store({ count: 0 })
    let second = models.store({ count: 10 })
    let firstCalls = 0
    let secondCalls = 0

    first.host.addEventListener('count', () => firstCalls++)
    second.host.addEventListener('count', () => secondCalls++)

    first.state.update((draft) => {
      draft.count = 1
    })

    assert.equal(first.state.value.count, 1)
    assert.equal(second.state.value.count, 10)
    assert.equal(firstCalls, 1)
    assert.equal(secondCalls, 0)

    assert.throws(
      () =>
        customEvents<{ count: number }>({ host: new EventTarget() }).store({
          count: 0,
        }),
      /supplies its own EventTarget host/,
    )
  })

  it('creates typed local-name events', () => {
    let events = createEvents()
    let otherEvents = createEvents()
    let first = events.create('submitted', { id: 'first' })
    let second = events.create('submitted', { id: 'second' })
    let signal = events.create('paid')

    assert.equal(first.detail.id, 'first')
    assert.equal(signal.detail, null)
    assert.ok(first !== second)
    assert.equal(first.type, second.type)
    assert.equal(first.type, 'submitted')
    assert.equal(first.cancelable, false)
    first.preventDefault()
    assert.equal(first.defaultPrevented, false)
    assert.equal(otherEvents.create('submitted', { id: 'other' }).type, 'submitted')
    let target = new EventTarget()
    let observed = false
    target.addEventListener('submitted', () => {
      observed = true
    })
    assert.equal(target.dispatchEvent(first), true)
    assert.equal(observed, true)

    let createWithEventInit = events.create as unknown as (
      type: 'submitted',
      detail: { id: string },
      init: EventInit,
    ) => CustomEvent<{ id: string }>
    assert.throws(
      () => createWithEventInit('submitted', { id: 'runtime-check' }, { cancelable: true }),
      /cannot be cancelable/,
    )

    if (false) {
      // @ts-expect-error - detailed events require detail.
      events.create('submitted')
      // @ts-expect-error - signal events do not accept detail.
      events.create('paid', 'unexpected')
      // @ts-expect-error - `*` is reserved for subscriptions.
      events.create('*')
      // @ts-expect-error - native DOM event names are reserved.
      customEvents<'click'>()
      customEvents<TestEvents>({
        host: new EventTarget(),
        // @ts-expect-error - factory host registration has no abort lifecycle.
        signal: new AbortController().signal,
      })
      // @ts-expect-error - descriptor events are completed, non-cancelable facts.
      events.create('paid', { cancelable: true })
      // @ts-expect-error - awaitable dispatch preserves detailed-event typing.
      events.dispatch(new EventTarget(), 'submitted')
      // @ts-expect-error - customEvents effects do not expose reentry signals.
      events.paid.on((_event, _signal) => {})
      events.on((event) => {
        switch (event.type) {
          case 'submitted':
            event.detail.id satisfies string
            break
          case 'paid':
          case 'focusRequested':
            event.detail satisfies null
            break
          default:
            event satisfies never
        }
      })
    }
  })

  it("throws an already-aborted signal's exact reason", () => {
    let events = createEvents()
    let controller = new AbortController()
    let reason = new Error('stale transition')
    controller.abort(reason)

    let factories = [() => events.create('paid', { signal: controller.signal })]

    for (let createEvent of factories) {
      let thrown: unknown
      try {
        createEvent()
      } catch (error) {
        thrown = error
      }
      assert.equal(thrown, reason)
    }
  })

  it('supports event names that collide with Function properties', async (t) => {
    let events = customEvents<'name' | 'length' | 'bind' | 'toString'>()

    function CollidingEventNames() {
      return () => (
        <section mix={events.asHost}>
          <events.view.output on={events.name} aria-label="name">
            {(event) => event?.type}
          </events.view.output>
          <events.view.output on={events.length} aria-label="length">
            {(event) => event?.type}
          </events.view.output>
          <events.view.output on={events.bind} aria-label="bind">
            {(event) => event?.type}
          </events.view.output>
          <events.view.output on={events.toString} aria-label="toString">
            {(event) => event?.type}
          </events.view.output>
        </section>
      )
    }

    let result = render(<CollidingEventNames />)
    t.after(() => result.cleanup())
    let section = result.$('section') as HTMLElement

    await result.act(async () => {
      await events.dispatch(section, ['name', 'length', 'bind', 'toString'])
    })

    for (let type of ['name', 'length', 'bind', 'toString']) {
      assert.equal(result.$(`[aria-label="${type}"]`)?.textContent, type)
    }
  })

  it('updates reactive props and children before running DOM effects', async (t) => {
    let events = createEvents()

    function Checkout() {
      return () => (
        <section mix={events.asHost}>
          <button
            aria-label="submit"
            mix={on('click', ({ currentTarget }) => {
              currentTarget.dispatchEvent(events.create('submitted', { id: 'order-1' }))
            })}
          >
            Submit
          </button>
          <events.view.form
            on={events.submitted}
            initial={events.create('submitted', { id: 'idle' })}
            aria-label="form"
            class={(event) => (event.detail.id === 'idle' ? '' : 'pending')}
            aria-busy={(event) => event.detail.id !== 'idle'}
            mix={events.submitted.on(({ currentTarget }) => {
              currentTarget.dataset.committed = String(currentTarget.classList.contains('pending'))
            })}
          >
            {(event) => <output>{event.detail.id}</output>}
          </events.view.form>
        </section>
      )
    }

    let result = render(<Checkout />)
    t.after(() => result.cleanup())
    let form = result.$('[aria-label="form"]') as HTMLFormElement

    assert.equal(form.className, '')
    assert.equal(form.textContent, 'idle')

    await result.act(() => (result.$('[aria-label="submit"]') as HTMLButtonElement).click())
    await settleEffects()

    assert.equal(result.$('[aria-label="form"]'), form)
    assert.equal(form.className, 'pending')
    assert.equal(form.getAttribute('aria-busy'), 'true')
    assert.equal(form.textContent, 'order-1')
    assert.equal(form.dataset.committed, 'true')
  })

  it('renders undefined until an occurrence first matches', async (t) => {
    let events = createEvents()

    function Confirmation() {
      return () => (
        <section mix={events.asHost} aria-label="confirmation-host">
          <events.view.output
            on={events.submitted}
            hidden={(event) => event === undefined}
            aria-label="confirmation"
          >
            {(event) => event?.detail.id ?? null}
          </events.view.output>
          <events.view.output
            on={events.submitted}
            initial={events.create('submitted', { id: 'initial' })}
            hidden={(event) => event.detail.id === 'hidden'}
            aria-label="initial-confirmation"
          >
            {(event) => event.detail.id}
          </events.view.output>
        </section>
      )
    }

    let result = render(<Confirmation />)
    t.after(() => result.cleanup())
    let host = result.$('[aria-label="confirmation-host"]') as HTMLElement
    let confirmation = result.$('[aria-label="confirmation"]') as HTMLOutputElement
    let initialConfirmation = result.$('[aria-label="initial-confirmation"]') as HTMLOutputElement

    assert.equal(confirmation.hidden, true)
    assert.equal(confirmation.textContent, '')
    assert.equal(initialConfirmation.hidden, false)
    assert.equal(initialConfirmation.textContent, 'initial')

    await result.act(() => host.dispatchEvent(events.create('paid')))
    assert.equal(confirmation.hidden, true)

    await result.act(() => host.dispatchEvent(events.create('submitted', { id: 'order-1' })))
    assert.equal(confirmation.hidden, false)
    assert.equal(confirmation.textContent, 'order-1')
  })

  it('commits the source view before downstream views', async (t) => {
    let events = createEvents()

    function Form() {
      return () => (
        <events.view.form
          aria-label="source"
          data-action={(event) => event?.type}
          mix={[
            events.asHost,
            on('focusout', ({ currentTarget }) => {
              currentTarget.dataset.actionSeenOnFocusout = currentTarget.dataset.action ?? 'missing'
            }),
          ]}
        >
          <events.view.input aria-label="input" disabled={(event) => event?.type === 'submitted'} />
        </events.view.form>
      )
    }

    let result = render(<Form />)
    t.after(() => result.cleanup())
    let form = result.$('[aria-label="source"]') as HTMLFormElement
    let input = result.$('[aria-label="input"]') as HTMLInputElement
    input.focus()

    await result.act(async () => {
      form.dispatchEvent(events.create('submitted', { id: 'order-1' }))
      await settleEffects()
    })

    assert.equal(input.disabled, true)
    assert.equal(form.dataset.action, 'submitted')
    assert.equal(form.dataset.actionSeenOnFocusout, 'submitted')
  })

  it('broadcasts named groups and wildcards to every listener', async (t) => {
    let events = createEvents()
    let initialOutcome = events.create('paid')

    function Orders() {
      return () => (
        <section mix={events.asHost}>
          <button
            aria-label="update"
            mix={on('click', ({ currentTarget }) => {
              currentTarget.dispatchEvent(events.create('submitted', { id: 'first' }))
            })}
          />
          {['first', 'second'].map((id) => (
            <events.view.output
              on={[events.submitted, events.paid]}
              initial={initialOutcome}
              aria-label={id}
              mix={events.on(({ currentTarget, type }) => {
                currentTarget.dataset.effect = type
              })}
            >
              {(event) => (event.type === 'submitted' ? event.detail.id : 'idle')}
            </events.view.output>
          ))}
          <events.view.output initial={initialOutcome} aria-label="all">
            {(event) => (event.type === 'paid' ? 'idle' : event.type)}
          </events.view.output>
        </section>
      )
    }

    let result = render(<Orders />)
    t.after(() => result.cleanup())

    await result.act(() => (result.$('[aria-label="update"]') as HTMLButtonElement).click())
    await settleEffects()

    let first = result.$('[aria-label="first"]') as HTMLOutputElement
    let second = result.$('[aria-label="second"]') as HTMLOutputElement
    assert.equal(first.textContent, 'first')
    assert.equal(first.dataset.effect, 'submitted')
    assert.equal(second.textContent, 'first')
    assert.equal(second.dataset.effect, 'submitted')
    assert.equal(result.$('[aria-label="all"]')?.textContent, 'submitted')

    await result.act(async () => {
      await events.dispatch(
        result.$('section') as HTMLElement,
        [
          {
            submitted: {
              detail: { id: 'first-again' },
            },
          },
          {
            submitted: {
              detail: { id: 'second' },
            },
          },
        ],
        { composed: true },
      )
    })

    assert.equal(first.textContent, 'second')
    assert.equal(second.textContent, 'second')
    assert.equal(first.dataset.effect, 'submitted')
    assert.equal(second.dataset.effect, 'submitted')
  })

  it('keeps unhosted events local and routes siblings through explicit hosts', async (t) => {
    let events = createEvents()

    function Scopes() {
      return () => (
        <div>
          <button
            aria-label="local"
            mix={[
              events.paid.on(({ currentTarget }) => {
                currentTarget.dataset.received = 'true'
              }),
              on('click', ({ currentTarget }) => {
                currentTarget.dispatchEvent(events.create('paid', { bubbles: false }))
              }),
            ]}
          />
          <section>
            <button
              aria-label="unhosted-source"
              mix={on('click', ({ currentTarget }) => {
                currentTarget.dispatchEvent(events.create('paid'))
              })}
            />
            <output
              aria-label="unhosted-listener"
              mix={events.paid.on(({ currentTarget }) => {
                currentTarget.textContent = 'received'
              })}
            />
          </section>
          <section mix={events.asHost}>
            <button
              aria-label="hosted-source"
              mix={on('click', ({ currentTarget }) => {
                currentTarget.dispatchEvent(events.create('paid'))
              })}
            />
            <output
              aria-label="hosted-listener"
              mix={events.paid.on(({ currentTarget }) => {
                currentTarget.textContent = 'received'
              })}
            />
          </section>
        </div>
      )
    }

    let result = render(<Scopes />)
    t.after(() => result.cleanup())
    let local = result.$('[aria-label="local"]') as HTMLButtonElement
    let foreignEventReachedParent = false
    result.container.addEventListener('paid', () => {
      foreignEventReachedParent = true
    })

    await result.act(() => local.click())
    assert.equal(local.dataset.received, 'true')

    await result.act(() =>
      (result.$('[aria-label="unhosted-source"]') as HTMLButtonElement).click(),
    )
    assert.equal(result.$('[aria-label="unhosted-listener"]')?.textContent, '')

    await result.act(() => (result.$('[aria-label="hosted-source"]') as HTMLButtonElement).click())
    assert.equal(result.$('[aria-label="hosted-listener"]')?.textContent, 'received')

    foreignEventReachedParent = false
    ;(result.$('[aria-label="hosted-source"]') as HTMLButtonElement).dispatchEvent(
      new CustomEvent('paid', { bubbles: true }),
    )
    assert.equal(foreignEventReachedParent, true)
  })

  it('contains non-composed events and lets composed events cross nested hosts', async (t) => {
    let events = createEvents()

    function NestedHosts() {
      return () => (
        <section
          mix={[
            events.asHost,
            events.submitted.on(({ currentTarget, detail }) => {
              currentTarget.dataset.latest = detail.id
            }),
          ]}
        >
          <form mix={events.asHost}>
            <button
              aria-label="local"
              mix={on('click', ({ currentTarget }) => {
                currentTarget.dispatchEvent(events.create('submitted', { id: 'local' }))
              })}
            />
            <button
              aria-label="composed"
              mix={on('click', ({ currentTarget }) => {
                events.dispatch(
                  currentTarget,
                  [
                    {
                      submitted: { detail: { id: 'composed' } },
                    },
                  ],
                  { composed: true },
                )
              })}
            />
          </form>
        </section>
      )
    }

    let result = render(<NestedHosts />)
    t.after(() => result.cleanup())
    let root = result.$('section') as HTMLElement

    await result.act(() => (result.$('[aria-label="local"]') as HTMLButtonElement).click())
    assert.equal(root.dataset.latest, undefined)

    await result.act(() => (result.$('[aria-label="composed"]') as HTMLButtonElement).click())
    assert.equal(root.dataset.latest, 'composed')
  })

  it('dispatches a transaction and awaits view updates and ordered effects', async (t) => {
    let events = createEvents()
    let viewUpdates = 0
    let effects: string[] = []
    let dispatchTarget!: HTMLButtonElement

    function Transaction() {
      return () => (
        <section mix={events.asHost}>
          <button
            aria-label="dispatch"
            mix={ref((button) => {
              dispatchTarget = button
            })}
          />
          <events.view.output
            aria-label="view"
            mix={events.on(async ({ type, currentTarget }) => {
              await Promise.resolve()
              effects.push(`${type}:${currentTarget.textContent}`)
            })}
          >
            {(event) => event && `${event.type}:${++viewUpdates}`}
          </events.view.output>
        </section>
      )
    }

    let result = render(<Transaction />)
    t.after(() => result.cleanup())

    await result.act(() =>
      events.dispatch(dispatchTarget, [
        {
          submitted: {
            detail: { id: 'batched' },
          },
        },
        'paid',
      ]),
    )

    assert.equal(result.$('[aria-label="view"]')?.textContent, 'paid:1')
    assert.deepEqual(effects, ['submitted:paid:1', 'paid:paid:1'])
  })

  it('mirrors batch entries only on configured domain EventTargets', async () => {
    let domain = new EventTarget()
    let events = createEvents({ host: domain })
    let nativeCalls: string[] = []
    domain.addEventListener('submitted', (event) => {
      nativeCalls.push(`submitted:${(event as CustomEvent<{ id: string }>).detail.id}`)
    })
    domain.addEventListener('paid', () => nativeCalls.push('paid'))

    await events.dispatch(domain, [{ submitted: { detail: { id: 'batch' } } }, 'paid'])
    await events.dispatch(domain, ['paid', 'paid'])

    assert.deepEqual(nativeCalls, ['submitted:batch', 'paid', 'paid', 'paid'])
  })

  it('catches a mount-time event after listener setup', async (t) => {
    let events = createEvents()

    function MountedInput() {
      return () => (
        <input
          aria-label="input"
          mix={[
            events.asHost,
            on('input', ({ currentTarget }) => {
              currentTarget.dispatchEvent(events.create('paid'))
            }),
            events.paid.on(({ currentTarget }) => {
              currentTarget.dataset.ready = 'true'
            }),
            ref((input) => input.dispatchEvent(new InputEvent('input'))),
          ]}
        />
      )
    }

    let result = render(<MountedInput />)
    t.after(() => result.cleanup())
    await result.act(() => Promise.resolve())

    assert.equal((result.$('[aria-label="input"]') as HTMLInputElement).dataset.ready, 'true')
  })

  it('indexes subscriptions by phase, type, and event address', async () => {
    let runtime = createCustomEventsRuntimeState()
    let host = document.createElement('section')
    let origin = document.createElement('button')
    host.append(origin)
    let unregisterHost = customEventsRuntime.registerHost(runtime, host)
    let calls: string[] = []
    let cleanups: Array<() => void> = []
    let assertCalls = (...expected: string[]) => {
      assert.deepEqual([...calls].sort(), [...expected].sort())
    }

    function subscribe(
      name: string,
      addresses: Record<string, ReadonlyArray<string>> | null,
      eventTypes: ReadonlySet<string> | null,
      phase: 'view' | 'effect' = 'view',
    ) {
      let element = document.createElement('output')
      host.append(element)
      let subscription = {
        element,
        eventTypes,
        ...(addresses === null ? {} : { addresses: new Map(Object.entries(addresses)) }),
        notify(event: CustomEvent) {
          calls.push(`${name}:${event.type}`)
        },
      }
      let cleanup =
        phase === 'effect'
          ? customEventsRuntime.subscribe(runtime, 'effect', subscription)
          : customEventsRuntime.subscribe(runtime, 'view', subscription)
      cleanups.push(cleanup)
      return cleanup
    }

    let removeExact = subscribe('exact', { updated: ['first'] }, new Set(['updated']))
    let removeBroad = subscribe('broad', null, new Set(['updated']))
    subscribe('other-key', { updated: ['second'] }, new Set(['updated']))
    subscribe('wildcard', { '*': ['first'] }, null)
    subscribe('effect', { updated: ['first'] }, new Set(['updated']), 'effect')

    function event(key?: string) {
      let init = { bubbles: true, cancelable: false }
      return customEventsRuntime.createProductEvent(runtime, 'updated', null, init, [
        {
          type: 'updated',
          detail: null,
          ...(key === undefined ? {} : { addresses: [[String(key)]] }),
        },
      ])
    }

    await customEventsRuntime.dispatch(runtime, origin, event('first'))
    assertCalls('broad:updated', 'exact:updated', 'wildcard:updated', 'effect:updated')

    calls = []
    await customEventsRuntime.dispatch(runtime, origin, event('second'))
    assertCalls('broad:updated', 'other-key:updated')

    calls = []
    await customEventsRuntime.dispatch(runtime, origin, event())
    assertCalls(
      'exact:updated',
      'broad:updated',
      'other-key:updated',
      'wildcard:updated',
      'effect:updated',
    )

    removeExact()
    removeBroad()
    calls = []
    await customEventsRuntime.dispatch(runtime, origin, event('first'))
    assertCalls('wildcard:updated', 'effect:updated')

    for (let cleanup of cleanups) cleanup()
    unregisterHost()
  })

  it('derives host containment independently of registration order', () => {
    let runtime = createCustomEventsRuntimeState()
    let parent = document.createElement('main')
    let host = document.createElement('section')
    parent.append(host)
    let reachedParent = false
    parent.addEventListener('updated', () => {
      reachedParent = true
    })

    let unsubscribe = customEventsRuntime.subscribe(runtime, 'view', {
      element: host,
      eventTypes: new Set(['updated']),
      notify() {},
    })
    let unregisterHost = customEventsRuntime.registerHost(runtime, host)
    let init = { bubbles: true, cancelable: false }
    host.dispatchEvent(
      customEventsRuntime.createProductEvent(runtime, 'updated', null, init, [
        {
          type: 'updated',
          detail: null,
        },
      ]),
    )

    assert.equal(reachedParent, false)
    unregisterHost()
    unsubscribe()
  })
})
