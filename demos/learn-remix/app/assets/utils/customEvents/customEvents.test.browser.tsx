import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { on, ref } from 'remix/ui'
import { render } from 'remix/ui/test'
import { customEvents, evented } from './index.tsx'
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
  it('resolves evented.<tag> to the intrinsic tag string with typed callback inputs', async (t) => {
    let events = customEvents<TestEvents>()
    assert.equal(evented.output, 'output')
    assert.equal(evented.button, 'button')
    assert.equal(typeof evented.div, 'string')

    function AliasView() {
      return () => (
        <section mix={events.asHost}>
          <evented.output
            eventSource={events.submitted}
            aria-label="typed"
            data-id={(detail) => detail?.id}
          >
            {(detail) => detail?.id ?? ''}
          </evented.output>
          <evented.output eventSource={events} aria-label="wildcard">
            {(detail, event) => (event ? event.type : '')}
          </evented.output>
        </section>
      )
    }

    let result = render(<AliasView />)
    t.after(() => result.cleanup())
    let typed = result.$('[aria-label="typed"]') as HTMLOutputElement
    let wildcard = result.$('[aria-label="wildcard"]') as HTMLOutputElement

    assert.equal(typed.textContent, '')
    await result.act(async () => {
      typed.dispatchEvent(events.create('submitted', { id: 'order-1' }))
      await settleEffects()
    })
    assert.equal(typed.dataset.id, 'order-1')
    assert.equal(typed.textContent, 'order-1')
    assert.equal(wildcard.textContent, 'submitted')
  })

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
      customEvents<{ count: number }>().store({ count: 0, store: true })
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
    let { state, events } = customEvents().store({
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
        <evented.output
          aria-label="name"
          eventSource={store.events.profile.name}
          class={(detail) => detail.toLowerCase()}
        >
          {(detail) => {
            detail satisfies string
            if (false) {
              // @ts-expect-error - detail is the selected value, not the snapshot.
              detail.toFixed()
            }
            renders++
            return detail
          }}
        </evented.output>
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
          <evented.output eventSource={store.events.position.get('a')}>
            {(detail) => `${++calls.mapA}:${detail ?? ''}`}
          </evented.output>
          <evented.output eventSource={store.events.position.get('b')}>
            {(detail) => `${++calls.mapB}:${detail ?? ''}`}
          </evented.output>
          <evented.output eventSource={store.events.position}>
            {(detail) => `${++calls.mapAll}:${detail.size}`}
          </evented.output>
          <evented.output eventSource={store.events.selected.has('red')}>
            {(detail) => `${++calls.red}:${detail}`}
          </evented.output>
          <evented.output eventSource={store.events.selected.has('blue')}>
            {(detail) => `${++calls.blue}:${detail}`}
          </evented.output>
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
    // Map item replaces skip whole-key subscribers: only the item's own
    // keyed route is notified.
    assert.deepEqual(calls, {
      mapA: 2,
      mapB: 1,
      mapAll: 1,
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
      mapAll: 1,
      red: 1,
      blue: 2,
    })
    assert.equal(positionEvents, 2)
  })

  it('renders keyed children from a store without component updates', async (t) => {
    let store = customEvents<{
      circles: Map<number, { id: number; x: number; r: number }>
    }>().store({
      circles: new Map([
        [1, { id: 1, x: 10, r: 5 }],
        [2, { id: 2, x: 20, r: 5 }],
      ]),
    })

    function Canvas() {
      return () => (
        <evented.svg eventSource={store.events.circles}>
          {(circles) =>
            [...circles.values()].map((circle) => (
              <evented.circle
                key={circle.id}
                eventSource={store.events.circles.get(circle.id).r}
                cx={circle.x}
                r={(radius) => radius ?? circle.r}
              />
            ))
          }
        </evented.svg>
      )
    }

    let result = render(<Canvas />)
    t.after(() => result.cleanup())

    let circles = () => result.$('svg')!.querySelectorAll('circle')
    assert.equal(circles().length, 2)
    let first = circles()[0]

    await result.act(async () => {
      store.state.update((draft) => {
        draft.circles.get(1)!.r = 9
      })
      await settleEffects()
    })
    // A Map item replace updates the item element in place and preserves the
    // DOM identity of every circle.
    assert.equal(circles().length, 2)
    assert.equal(circles()[0], first)
    assert.equal((circles()[0] as SVGCircleElement).getAttribute('r'), '9')

    await result.act(async () => {
      store.state.update((draft) => {
        draft.circles.set(3, { id: 3, x: 30, r: 7 })
      })
      await settleEffects()
    })
    assert.equal(circles().length, 3)
    assert.equal(circles()[0], first)

    await result.act(async () => {
      store.state.update((draft) => {
        draft.circles = new Map([[1, { id: 1, x: 10, r: 3 }]])
      })
      await settleEffects()
    })
    // Whole-key replaces reconcile the keyed diff: removed circles unmount,
    // retained circles keep their DOM node.
    assert.equal(circles().length, 1)
    assert.equal(circles()[0], first)
    assert.equal((circles()[0] as SVGCircleElement).getAttribute('r'), '3')
  })

  it('applies store updates to keyed list children fine-grained', async (t) => {
    let store = customEvents<{
      circles: Map<number, { id: number; x: number; r: number }>
    }>().store({
      circles: new Map([
        [1, { id: 1, x: 10, r: 5 }],
        [2, { id: 2, x: 20, r: 5 }],
      ]),
    })
    let templateCalls = 0

    function Canvas() {
      return () => (
        <svg>
          <evented.list eventSource={store.events.circles}>
            {(circle, id) => {
              templateCalls++
              return (
                <evented.circle
                  key={id}
                  eventSource={store.events.circles.get(id).r}
                  cx={circle.x}
                  r={(radius) => radius ?? circle.r}
                />
              )
            }}
          </evented.list>
        </svg>
      )
    }

    let result = render(<Canvas />)
    t.after(() => result.cleanup())

    let circles = () => result.$('svg')!.querySelectorAll('circle')
    assert.equal(circles().length, 2)
    assert.equal(templateCalls, 2)
    let first = circles()[0]

    await result.act(async () => {
      store.state.update((draft) => {
        draft.circles.get(1)!.r = 9
      })
      await settleEffects()
    })
    // Map item replaces skip whole-key subscribers: the list does not
    // re-resolve while the item element follows its own keyed route.
    assert.equal(templateCalls, 2)
    assert.equal(circles().length, 2)
    assert.equal(circles()[0], first)
    assert.equal((circles()[0] as SVGCircleElement).getAttribute('r'), '9')

    await result.act(async () => {
      store.state.update((draft) => {
        draft.circles.set(3, { id: 3, x: 30, r: 7 })
      })
      await settleEffects()
    })
    assert.equal(templateCalls, 3)
    assert.equal(circles().length, 3)
    assert.equal(circles()[0], first)
    assert.equal((circles()[2] as SVGCircleElement).getAttribute('r'), '7')

    await result.act(async () => {
      store.state.update((draft) => {
        draft.circles.delete(2)
      })
      await settleEffects()
    })
    assert.equal(templateCalls, 3)
    assert.equal(circles().length, 2)
    assert.equal(circles()[0], first)
  })

  it('settles coalesced bursts of list updates on the final store value', async (t) => {
    let store = customEvents<{
      items: Map<number, { id: number; label: string }>
    }>().store({
      items: new Map([
        [1, { id: 1, label: 'one' }],
        [2, { id: 2, label: 'two' }],
      ]),
    })
    let templateCalls = 0

    function Items() {
      return () => (
        <section>
          <evented.list eventSource={store.events.items}>
            {(item, id) => {
              templateCalls++
              return (
                <div key={id} className="item">
                  {item.label}
                </div>
              )
            }}
          </evented.list>
        </section>
      )
    }

    let result = render(<Items />)
    t.after(() => result.cleanup())
    let items = () => result.$('section')!.querySelectorAll('.item')
    assert.equal(items().length, 2)

    // A synchronous burst coalesces into one list update; every add lands.
    await result.act(async () => {
      store.state.update((draft) => {
        draft.items.set(3, { id: 3, label: 'three' })
      })
      store.state.update((draft) => {
        draft.items.set(4, { id: 4, label: 'four' })
      })
      store.state.update((draft) => {
        draft.items.set(5, { id: 5, label: 'five' })
      })
      await settleEffects()
    })
    // The coalesced update falls back to re-resolving every item.
    assert.equal(templateCalls, 7)
    assert.equal(items().length, 5)
    assert.equal(items()[4].textContent, 'five')

    // A mixed burst of adds and removals settles on the final state.
    await result.act(async () => {
      store.state.update((draft) => {
        draft.items.delete(2)
      })
      store.state.update((draft) => {
        draft.items.set(6, { id: 6, label: 'six' })
      })
      store.state.update((draft) => {
        draft.items.delete(4)
      })
      await settleEffects()
    })
    assert.equal(templateCalls, 11)
    assert.equal(items().length, 4)
    assert.equal([...items()].map((item) => item.textContent).join(','), 'one,three,five,six')
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
          <evented.output eventSource={store.events.columns.get('column:todo')}>
            {() => String(++calls.todo)}
          </evented.output>
          <evented.output eventSource={store.events.columns.get('column:done')}>
            {() => String(++calls.done)}
          </evented.output>
          <evented.output
            eventSource={store.events.columns.get('column:todo').cards.get('card:one')}
          >
            {() => String(++calls.one)}
          </evented.output>
          <evented.output
            eventSource={store.events.columns.get('column:todo').cards.get('card:two')}
          >
            {() => String(++calls.two)}
          </evented.output>
          <evented.output
            eventSource={store.events.columns.get('column:done').cards.get('card:three')}
          >
            {() => String(++calls.three)}
          </evented.output>
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
        <evented.output eventSource={store.events.records.get(recordKey).value}>
          {(detail) => `${++renders}:${detail}`}
        </evented.output>
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
          <evented.output eventSource={store.events.items[0]}>
            {() => String(++calls.first)}
          </evented.output>
          <evented.output eventSource={store.events.items[1]} aria-label="1">
            {() => String(++calls.second)}
          </evented.output>
          <evented.output eventSource={store.events.items}>
            {() => String(++calls.all)}
          </evented.output>
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
          <evented.output eventSource={store.events.circles[0]}>
            {() => String(++calls.circle0)}
          </evented.output>
          <evented.output eventSource={store.events.circles[1]} aria-label="1">
            {() => String(++calls.circle1)}
          </evented.output>
          <evented.output eventSource={store.events.values.A0}>
            {() => String(++calls.A0)}
          </evented.output>
          <evented.output eventSource={store.events.values.B0}>
            {() => String(++calls.B0)}
          </evented.output>
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
          <evented.button
            eventSource={store.events.selected.as('1')}
            aria-label="1"
            type="button"
            aria-pressed={(detail) => detail}
            mix={store.events.selected.as('1').on(({ currentTarget, detail }) => {
              effectOrder.push(currentTarget.getAttribute('aria-label') ?? '')
              if (detail === '1') {
                currentTarget.focus()
              }
            })}
          >
            {() => String(++calls.first)}
          </evented.button>
          <evented.button
            eventSource={store.events.selected.as('2')}
            aria-label="2"
            type="button"
            aria-pressed={(detail) => detail}
            mix={store.events.selected.as('2').on(({ currentTarget, detail }) => {
              effectOrder.push(currentTarget.getAttribute('aria-label') ?? '')
              if (detail === '2') {
                currentTarget.focus()
              }
            })}
          >
            {() => String(++calls.second)}
          </evented.button>
          <evented.output eventSource={store.events.selected}>
            {() => String(++calls.all)}
          </evented.output>
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
        <evented.output eventSource={[store.events.count, store.events.countDrafted]}>
          {([count, draft]) => `${draft ?? count}:${++renders}`}
        </evented.output>
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
          <evented.output aria-label="listener" eventSource={store.events.countDrafted}>
            {(detail) => (detail === undefined ? 'idle' : `${detail}:${++listenerRenders}`)}
          </evented.output>
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

  it('renders the whole state snapshot through the wildcard source', async (t) => {
    let store = customEvents<{
      count: number
      countDrafted: number
    }>().store({ count: 0 })
    let seen: unknown[] = []

    function Snapshot() {
      return () => (
        <evented.output eventSource={store.events} aria-label="snapshot">
          {(detail) => {
            seen.push(detail)
            if (false) {
              detail satisfies number | { readonly count: number }
            }
            return typeof detail === 'object' && detail !== null
              ? `count:${detail.count}`
              : `raw:${detail}`
          }}
        </evented.output>
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
          <evented.output eventSource={events.name} aria-label="name">
            {(detail, event) => event?.type}
          </evented.output>
          <evented.output eventSource={events.length} aria-label="length">
            {(detail, event) => event?.type}
          </evented.output>
          <evented.output eventSource={events.bind} aria-label="bind">
            {(detail, event) => event?.type}
          </evented.output>
          <evented.output eventSource={events.toString} aria-label="toString">
            {(detail, event) => event?.type}
          </evented.output>
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
          <evented.form
            eventSource={events.submitted}
            initial={events.create('submitted', { id: 'idle' })}
            aria-label="form"
            class={(detail, event) => (detail.id === 'idle' ? '' : 'pending')}
            aria-busy={(detail, event) => detail.id !== 'idle'}
            mix={events.submitted.on(({ currentTarget }) => {
              currentTarget.dataset.committed = String(currentTarget.classList.contains('pending'))
            })}
          >
            {(detail, event) => <output>{detail.id}</output>}
          </evented.form>
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
          <evented.output
            eventSource={events.submitted}
            hidden={(detail, event) => detail === undefined}
            aria-label="confirmation"
          >
            {(detail, event) => detail?.id ?? null}
          </evented.output>
          <evented.output
            eventSource={events.submitted}
            initial={events.create('submitted', { id: 'initial' })}
            hidden={(detail, event) => detail.id === 'hidden'}
            aria-label="initial-confirmation"
          >
            {(detail, event) => detail.id}
          </evented.output>
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
        <evented.form
          eventSource={events}
          aria-label="source"
          data-action={(detail, event) => event?.type}
          mix={[
            events.asHost,
            on('focusout', ({ currentTarget }) => {
              currentTarget.dataset.actionSeenOnFocusout = currentTarget.dataset.action ?? 'missing'
            }),
          ]}
        >
          <evented.input
            eventSource={events}
            aria-label="input"
            disabled={(detail, event) => event?.type === 'submitted'}
          />
        </evented.form>
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
            <evented.output
              eventSource={[events.submitted, events.paid]}
              initial={initialOutcome}
              aria-label={id}
              mix={events.on(({ currentTarget, type }) => {
                currentTarget.dataset.effect = type
              })}
            >
              {([detail], event) => (event.type === 'submitted' ? detail.id : 'idle')}
            </evented.output>
          ))}
          <evented.output eventSource={events} initial={initialOutcome} aria-label="all">
            {(detail, event) => (event.type === 'paid' ? 'idle' : event.type)}
          </evented.output>
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
          <evented.output
            eventSource={events}
            aria-label="view"
            mix={events.on(async ({ type, currentTarget }) => {
              await Promise.resolve()
              effects.push(`${type}:${currentTarget.textContent}`)
            })}
          >
            {(detail, event) => event && `${event.type}:${++viewUpdates}`}
          </evented.output>
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

  it('skips whole-key subscribers only for Map item replace events', async () => {
    let runtime = createCustomEventsRuntimeState()
    let host = document.createElement('section')
    let origin = document.createElement('button')
    host.append(origin)
    let unregisterHost = customEventsRuntime.registerHost(runtime, host)
    let calls: string[] = []
    let cleanups: Array<() => void> = []
    let init = { bubbles: true, cancelable: false }

    function subscribe(name: string, address: readonly string[]) {
      let element = document.createElement('output')
      host.append(element)
      let subscription = {
        element,
        eventTypes: new Set(['updated']),
        addresses: new Map([['updated', address]]),
        notify() {
          calls.push(name)
        },
      }
      let cleanup = customEventsRuntime.subscribe(runtime, 'view', subscription)
      cleanups.push(cleanup)
    }

    subscribe('whole', [])
    subscribe('key', ['circle:1'])

    function event(
      addresses: readonly (readonly string[])[],
      ops?: readonly ('add' | 'remove' | 'replace' | 'mapReplace')[],
    ) {
      return customEventsRuntime.createProductEvent(runtime, 'updated', null, init, [
        {
          type: 'updated',
          detail: null,
          addresses,
          ...(ops === undefined ? {} : { ops }),
        },
      ])
    }

    await customEventsRuntime.dispatch(runtime, origin, event([['circle:1']], ['mapReplace']))
    assert.deepEqual(calls, ['key'])

    calls = []
    await customEventsRuntime.dispatch(runtime, origin, event([['circle:2']], ['add']))
    assert.deepEqual(calls, ['whole'])

    calls = []
    await customEventsRuntime.dispatch(runtime, origin, event([['circle:1']], ['remove']))
    assert.deepEqual(calls, ['whole', 'key'])

    calls = []
    await customEventsRuntime.dispatch(runtime, origin, event([[]], ['replace']))
    assert.deepEqual(calls, ['whole', 'key'])

    // Entries without op classification keep the previous behavior.
    calls = []
    await customEventsRuntime.dispatch(runtime, origin, event([['circle:1']]))
    assert.deepEqual(calls, ['whole', 'key'])

    for (let cleanup of cleanups) cleanup()
    unregisterHost()
  })

  it('warns once when Map item replaces skip a whole-key subscriber', async () => {
    let runtime = createCustomEventsRuntimeState()
    let host = document.createElement('section')
    let origin = document.createElement('button')
    host.append(origin)
    let unregisterHost = customEventsRuntime.registerHost(runtime, host)
    let warnings: string[] = []
    let originalWarn = console.warn
    console.warn = (message) => warnings.push(String(message))
    try {
      let cleanup = customEventsRuntime.subscribe(runtime, 'view', {
        element: host,
        eventTypes: new Set(['updated']),
        notify() {},
      })
      let init = { bubbles: true, cancelable: false }
      let event = (ops: readonly ('add' | 'remove' | 'replace' | 'mapReplace')[]) =>
        customEventsRuntime.createProductEvent(runtime, 'updated', null, init, [
          {
            type: 'updated',
            detail: null,
            addresses: [['circle:1']],
            ops,
          },
        ])

      await customEventsRuntime.dispatch(runtime, origin, event(['mapReplace']))
      assert.equal(warnings.length, 1)
      assert.match(warnings[0]!, /subscribe per item/i)

      await customEventsRuntime.dispatch(runtime, origin, event(['mapReplace']))
      assert.equal(warnings.length, 1)

      cleanup()
    } finally {
      console.warn = originalWarn
    }
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
