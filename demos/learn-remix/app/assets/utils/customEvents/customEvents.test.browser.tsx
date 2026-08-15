import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { on, ref } from 'remix/ui'
import { render } from 'remix/ui/test'
import { customEvents, evented } from './index.tsx'
import { createCustomEventsRuntimeState, customEventsRuntime } from './runtime.ts'
import type { EventDetails } from './types.ts'

type TestEvents = {
  submitted: { id: string }
  paid: null
  focusRequested: null
}

function createEvents() {
  return customEvents<TestEvents>()
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
        <section mix={events.asHost()}>
          <evented.output
            on={events.on.submitted}
            aria-label="typed"
            data-id={(order) => order?.id}
          >
            {(order) => order?.id ?? ''}
          </evented.output>
          <evented.output on={events} aria-label="wildcard">
            {(value, event) => (event ? event.type : '')}
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
      typed.dispatchEvent(events.create({ submitted: { id: 'order-1' } }))
      await settleEffects()
    })
    assert.equal(typed.dataset.id, 'order-1')
    assert.equal(typed.textContent, 'order-1')
    assert.equal(wildcard.textContent, 'submitted')
  })

  it('routes Map and Set folds to item and whole-key subscribers', async (t) => {
    let events = customEvents({
      root: {
        position: new Map([
          ['a', 'X'],
          ['b', 'O'],
        ]),
        selected: new Set(['red']),
      },

      set: ({ key, value }: { key: string; value: string }, root) => {
        root.position.set(key, value)
      },
      add: (value: string, root) => {
        root.selected.add(value)
      },
    })
    let calls = { mapA: 0, mapB: 0, mapAll: 0, red: 0, blue: 0 }
    let positionEvents = 0
    events.addEventListener('position', () => positionEvents++)

    function Collections() {
      return () => (
        <section>
          <evented.output on={events.on.position.get('a')}>
            {(mark) => `${++calls.mapA}:${mark ?? ''}`}
          </evented.output>
          <evented.output on={events.on.position.get('b')}>
            {(mark) => `${++calls.mapB}:${mark ?? ''}`}
          </evented.output>
          <evented.output on={events.on.position}>
            {(positions) => `${++calls.mapAll}:${positions.size}`}
          </evented.output>
          <evented.output on={events.on.selected.has('red')}>
            {(selected) => `${++calls.red}:${selected}`}
          </evented.output>
          <evented.output on={events.on.selected.has('blue')}>
            {(selected) => `${++calls.blue}:${selected}`}
          </evented.output>
        </section>
      )
    }

    let result = render(<Collections />)
    t.after(() => result.cleanup())

    await result.act(async () => {
      await events.dispatchEvent({ set: { key: 'a', value: 'A' } })
      await settleEffects()
    })
    // A Map item replace notifies the item's own keyed route and every
    // whole-key subscriber.
    assert.deepEqual(calls, {
      mapA: 2,
      mapB: 1,
      mapAll: 2,
      red: 1,
      blue: 1,
    })
    assert.equal(positionEvents, 1)

    await result.act(async () => {
      await events.dispatchEvent({ set: { key: 'a', value: 'AA' } })
      await events.dispatchEvent({ set: { key: 'b', value: 'BB' } })
      await events.dispatchEvent({ add: 'blue' })
      await settleEffects()
    })
    assert.equal(calls.mapA, 3)
    assert.equal(calls.mapB, 2)
    assert.equal(calls.red, 1)
    assert.equal(calls.blue, 2)
    // The awaited burst may coalesce whole-key updates in the scheduler, so
    // the whole-key view sees between two and three settled re-renders.
    assert.ok(calls.mapAll >= 4 && calls.mapAll <= 5, `mapAll=${calls.mapAll}`)
    assert.equal(positionEvents, 3)
  })

  it('renders keyed children from a remembered descriptor without component updates', async (t) => {
    let events = customEvents({
      root: {
        circles: new Map<number, { id: number; x: number; r: number }>([
          [1, { id: 1, x: 10, r: 5 }],
          [2, { id: 2, x: 20, r: 5 }],
        ]),
      },

      resize: ({ id, r }: { id: number; r: number }, root) => {
        let circle = root.circles.get(id)
        if (circle) circle.r = r
      },
      add: (circle: { id: number; x: number; r: number }, root) => {
        root.circles.set(circle.id, circle)
      },
      replace: (circles: Map<number, { id: number; x: number; r: number }>, root) => {
        root.circles = circles
      },
    })

    function Canvas() {
      return () => (
        <evented.svg on={events.on.circles}>
          {(circles) =>
            [...circles.values()].map((circle) => (
              <evented.circle
                key={circle.id}
                on={events.on.circles.get(circle.id).r}
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
      await events.dispatchEvent({ resize: { id: 1, r: 9 } })
      await settleEffects()
    })
    // A Map item replace updates the item element in place and preserves the
    // DOM identity of every circle.
    assert.equal(circles().length, 2)
    assert.equal(circles()[0], first)
    assert.equal((circles()[0] as SVGCircleElement).getAttribute('r'), '9')

    await result.act(async () => {
      await events.dispatchEvent({ add: { id: 3, x: 30, r: 7 } })
      await settleEffects()
    })
    assert.equal(circles().length, 3)
    assert.equal(circles()[0], first)

    await result.act(async () => {
      await events.dispatchEvent({
        replace: new Map([[1, { id: 1, x: 10, r: 3 }]]),
      })
      await settleEffects()
    })
    // Whole-key replaces reconcile the keyed diff: removed circles unmount,
    // remembered circles keep their DOM node.
    assert.equal(circles().length, 1)
    assert.equal(circles()[0], first)
    assert.equal((circles()[0] as SVGCircleElement).getAttribute('r'), '3')
  })

  it('reconciles keyed children through the keyed diff', async (t) => {
    let events = customEvents({
      root: {
        circles: new Map<number, { id: number; x: number; r: number }>([
          [1, { id: 1, x: 10, r: 5 }],
          [2, { id: 2, x: 20, r: 5 }],
        ]),
      },

      resize: ({ id, r }: { id: number; r: number }, root) => {
        let circle = root.circles.get(id)
        if (circle) circle.r = r
      },
      add: (circle: { id: number; x: number; r: number }, root) => {
        root.circles.set(circle.id, circle)
      },
      remove: (id: number, root) => {
        root.circles.delete(id)
      },
    })

    function Canvas() {
      return () => (
        <evented.svg on={events.on.circles}>
          {(circles) =>
            [...circles.entries()].map(([id, circle]) => (
              <evented.circle
                key={id}
                on={events.on.circles.get(id).r}
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
      await events.dispatchEvent({ resize: { id: 1, r: 9 } })
      await settleEffects()
    })
    // The item element follows its own keyed route while the whole-key view
    // re-resolves; the keyed diff keeps every circle's DOM identity.
    assert.equal(circles().length, 2)
    assert.equal(circles()[0], first)
    assert.equal((circles()[0] as SVGCircleElement).getAttribute('r'), '9')

    await result.act(async () => {
      await events.dispatchEvent({ add: { id: 3, x: 30, r: 7 } })
      await settleEffects()
    })
    assert.equal(circles().length, 3)
    assert.equal(circles()[0], first)
    assert.equal((circles()[2] as SVGCircleElement).getAttribute('r'), '7')

    await result.act(async () => {
      await events.dispatchEvent({ remove: 2 })
      await settleEffects()
    })
    assert.equal(circles().length, 2)
    assert.equal(circles()[0], first)
  })

  it('settles coalesced bursts of list folds on the final value', async (t) => {
    let events = customEvents({
      root: {
        items: new Map<number, { id: number; label: string }>([
          [1, { id: 1, label: 'one' }],
          [2, { id: 2, label: 'two' }],
        ]),
      },

      add: (item: { id: number; label: string }, root) => {
        root.items.set(item.id, item)
      },
      remove: (id: number, root) => {
        root.items.delete(id)
      },
    })
    let viewCalls = 0

    function Items() {
      return () => (
        <section>
          <evented.div on={events.on.items}>
            {(items) => {
              viewCalls++
              return (
                <>
                  {[...items.entries()].map(([id, item]) => (
                    <div key={id} className="item">
                      {item.label}
                    </div>
                  ))}
                </>
              )
            }}
          </evented.div>
        </section>
      )
    }

    let result = render(<Items />)
    t.after(() => result.cleanup())
    let items = () => result.$('section')!.querySelectorAll('.item')
    assert.equal(items().length, 2)

    // A synchronous burst settles on the final value.
    await result.act(async () => {
      await events.dispatchEvent({ add: { id: 3, label: 'three' } })
      await events.dispatchEvent({ add: { id: 4, label: 'four' } })
      await events.dispatchEvent({ add: { id: 5, label: 'five' } })
      await settleEffects()
    })
    assert.equal(items().length, 5)
    assert.equal(items()[4].textContent, 'five')

    // A mixed burst of adds and removals settles on the final state.
    await result.act(async () => {
      await events.dispatchEvent({ remove: 2 })
      await events.dispatchEvent({ add: { id: 6, label: 'six' } })
      await events.dispatchEvent({ remove: 4 })
      await settleEffects()
    })
    assert.equal(items().length, 4)
    assert.equal([...items()].map((item) => item.textContent).join(','), 'one,three,five,six')
  })

  it('routes deep patches through every nested identity boundary', async (t) => {
    let events = customEvents({
      root: {
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
      },

      toggle: ({ columnId, cardId }: { columnId: string; cardId: string }, root) => {
        let card = root.columns.get(columnId)?.cards.get(cardId)
        if (card) card.urgent = !card.urgent
      },
    })
    let calls = { todo: 0, done: 0, one: 0, two: 0, three: 0 }

    function Board() {
      return () => (
        <section>
          <evented.output on={events.on.columns.get('column:todo')}>
            {() => String(++calls.todo)}
          </evented.output>
          <evented.output on={events.on.columns.get('column:done')}>
            {() => String(++calls.done)}
          </evented.output>
          <evented.output on={events.on.columns.get('column:todo').cards.get('card:one')}>
            {() => String(++calls.one)}
          </evented.output>
          <evented.output on={events.on.columns.get('column:todo').cards.get('card:two')}>
            {() => String(++calls.two)}
          </evented.output>
          <evented.output
            on={events.on.columns.get('column:done').cards.get('card:three')}
          >
            {() => String(++calls.three)}
          </evented.output>
        </section>
      )
    }

    let result = render(<Board />)
    t.after(() => result.cleanup())

    await result.act(async () => {
      await events.dispatchEvent({ toggle: { columnId: 'column:todo', cardId: 'card:one' } })
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

  it('preserves object identity in Map fold addresses', async (t) => {
    let recordKey = {}
    let events = customEvents({
      root: {
        records: new Map<object, { value: number }>([[recordKey, { value: 1 }]]),
      },

      set: ({ key, value }: { key: object; value: number }, root) => {
        let record = root.records.get(key)
        if (record) record.value = value
      },
    })
    let renders = 0

    function RecordValue() {
      return () => (
        <evented.output on={events.on.records.get(recordKey).value}>
          {(value) => `${++renders}:${value}`}
        </evented.output>
      )
    }

    let result = render(<RecordValue />)
    t.after(() => result.cleanup())

    await result.act(async () => {
      await events.dispatchEvent({ set: { key: recordKey, value: 2 } })
      await settleEffects()
    })

    assert.equal(renders, 2)
    assert.equal(result.$('output')?.textContent, '2:2')
  })

  it('derives array index routes by default', async (t) => {
    let events = customEvents({
      root: {
        items: ['first', 'second'],
      },

      set: ({ index, value }: { index: number; value: string }, root) => {
        root.items[index] = value
      },
      removeFirst: (_detail, root) => {
        root.items.splice(0, 1)
      },
      replace: (items: string[], root) => {
        root.items = items
      },
    })
    let calls = { first: 0, second: 0, all: 0 }

    function Items() {
      return () => (
        <section>
          <evented.output on={events.on.items[0]}>
            {() => String(++calls.first)}
          </evented.output>
          <evented.output on={events.on.items[1]} aria-label="1">
            {() => String(++calls.second)}
          </evented.output>
          <evented.output on={events.on.items}>{() => String(++calls.all)}</evented.output>
        </section>
      )
    }

    let result = render(<Items />)
    t.after(() => result.cleanup())

    await result.act(async () => {
      await events.dispatchEvent({ set: { index: 1, value: 'updated' } })
      await settleEffects()
    })
    assert.deepEqual(calls, { first: 1, second: 2, all: 2 })

    await result.act(async () => {
      await events.dispatchEvent({ removeFirst: null })
      await settleEffects()
    })
    assert.deepEqual(calls, { first: 2, second: 3, all: 3 })

    await result.act(async () => {
      await events.dispatchEvent({ replace: ['replacement'] })
      await settleEffects()
    })
    assert.deepEqual(calls, { first: 3, second: 4, all: 4 })
  })

  it('routes object arrays by index', async (t) => {
    type Circle = { id: number; diameter: number }
    let events = customEvents({
      root: {
        circles: [
          { id: 7, diameter: 30 },
          { id: 8, diameter: 40 },
        ],
        values: { A0: '10', B0: '20' },
      },

      resize: ({ index, diameter }: { index: number; diameter: number }, root) => {
        let circle = root.circles[index]
        if (circle) circle.diameter = diameter
      },
      setValue: ({ key, value }: { key: string; value: string }, root) => {
        ;(root.values as Record<string, string>)[key] = value
      },
      removeFirst: (_detail, root) => {
        root.circles.splice(0, 1)
      },
      replace: (circles: Circle[], root) => {
        root.circles = circles
      },
    })
    let calls = { circle0: 0, circle1: 0, A0: 0, B0: 0 }

    function Collections() {
      return () => (
        <section>
          <evented.output on={events.on.circles[0]}>
            {() => String(++calls.circle0)}
          </evented.output>
          <evented.output on={events.on.circles[1]} aria-label="1">
            {() => String(++calls.circle1)}
          </evented.output>
          <evented.output on={events.on.values.A0}>
            {() => String(++calls.A0)}
          </evented.output>
          <evented.output on={events.on.values.B0}>
            {() => String(++calls.B0)}
          </evented.output>
        </section>
      )
    }

    let result = render(<Collections />)
    t.after(() => result.cleanup())

    await result.act(async () => {
      await events.dispatchEvent({ resize: { index: 0, diameter: 35 } })
      await events.dispatchEvent({ setValue: { key: 'A0', value: '11' } })
      await settleEffects()
    })
    assert.deepEqual(calls, { circle0: 2, circle1: 1, A0: 2, B0: 1 })

    await result.act(async () => {
      await events.dispatchEvent({ removeFirst: null })
      await settleEffects()
    })
    assert.deepEqual(calls, { circle0: 3, circle1: 2, A0: 2, B0: 1 })

    await result.act(async () => {
      await events.dispatchEvent({
        replace: [
          { id: 7, diameter: 50 },
          {
            id: 8,
            diameter: 60,
          },
        ],
      })
      await settleEffects()
    })
    assert.deepEqual(calls, { circle0: 4, circle1: 3, A0: 2, B0: 1 })
  })

  it('routes scalar identity values by value and notifies owners via as()', async (t) => {
    let events = customEvents({
      root: {
        selected: null as string | null,
      },

      select: (id: string | null, root) => {
        root.selected = id
      },
    })
    let calls = { first: 0, second: 0, all: 0 }
    let effectOrder: string[] = []

    function Selection() {
      return () => (
        <section>
          <evented.button
            on={events.on.selected.as('1')}
            aria-label="1"
            type="button"
            aria-pressed={(selected) => selected}
            mix={events.on.selected.as('1')(({ currentTarget, detail }) => {
              effectOrder.push(currentTarget.getAttribute('aria-label') ?? '')
              if (detail === '1') {
                currentTarget.focus()
              }
            })}
          >
            {() => String(++calls.first)}
          </evented.button>
          <evented.button
            on={events.on.selected.as('2')}
            aria-label="2"
            type="button"
            aria-pressed={(selected) => selected}
            mix={events.on.selected.as('2')(({ currentTarget, detail }) => {
              effectOrder.push(currentTarget.getAttribute('aria-label') ?? '')
              if (detail === '2') {
                currentTarget.focus()
              }
            })}
          >
            {() => String(++calls.second)}
          </evented.button>
          <evented.output on={events.on.selected}>
            {() => String(++calls.all)}
          </evented.output>
        </section>
      )
    }

    let result = render(<Selection />)
    t.after(() => result.cleanup())

    await result.act(async () => {
      await events.dispatchEvent({ select: '1' })
      await settleEffects()
    })
    assert.deepEqual(calls, { first: 2, second: 1, all: 2 })
    assert.deepEqual(effectOrder, ['1'])
    assert.equal(document.activeElement?.getAttribute('aria-label'), '1')

    effectOrder.length = 0
    await result.act(async () => {
      await events.dispatchEvent({ select: '2' })
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
      await events.dispatchEvent({ select: null })
      await settleEffects()
    })
    assert.deepEqual(calls, { first: 3, second: 3, all: 4 })
    assert.equal(
      (result.$('[aria-label="2"]') as HTMLButtonElement).getAttribute('aria-pressed'),
      'false',
    )
  })

  it('keeps element-dispatched occurrences on the origin element', async (t) => {
    let events = customEvents({
      root: {
        count: 0,
      },

      increment: (amount: number, root) => {
        root.count += amount
      },
      countDrafted: (count: number) => {},
    })
    let drafts = 0
    let listenerRenders = 0

    function Editor() {
      return () => (
        <section>
          <button
            aria-label="source"
            mix={[
              events.on.countDrafted(() => {
                drafts++
              }),
              on('click', ({ currentTarget }) => {
                currentTarget.dispatchEvent(events.create({ countDrafted: 1 }))
              }),
            ]}
          />
          <evented.output aria-label="listener" on={events.on.countDrafted}>
            {(count) => (count === undefined ? 'idle' : `${count}:${++listenerRenders}`)}
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
      events.dispatchEvent({ countDrafted: 2 })
      await settleEffects()
    })
    assert.equal(listenerRenders, 1)
    assert.equal(listener.textContent, '2:1')
  })

  it('renders the whole composite through the wildcard source', async (t) => {
    let events = customEvents({
      root: {
        count: 0,
      },

      increment: (amount: number, root) => {
        root.count += amount
      },
      countDrafted: (count: number) => {},
    })
    let seen: Array<[{ count: number }, unknown]> = []

    function Snapshot() {
      return () => (
        <evented.output on={events} aria-label="snapshot">
          {(detail, event) => {
            seen.push([detail, event?.type])
            if (false) {
              detail satisfies { readonly count: number }
              // @ts-expect-error - the composite read is readonly-typed.
              detail.count = 1
            }
            let last = event?.type === 'countDrafted' ? ` raw:${event.detail}` : ''
            return `count:${detail.count}${last}`
          }}
        </evented.output>
      )
    }

    let result = render(<Snapshot />)
    t.after(() => result.cleanup())

    assert.equal(result.$('[aria-label="snapshot"]')?.textContent, 'count:0')
    assert.equal(seen.length, 1)
    assert.equal(seen[0]?.[0]?.count, 0)
    assert.equal(seen[0]?.[1], undefined)

    await result.act(async () => {
      await events.dispatchEvent({ increment: 1 })
      await settleEffects()
    })
    assert.equal(result.$('[aria-label="snapshot"]')?.textContent, 'count:1')
    assert.deepEqual(seen[seen.length - 1], [{ count: 1 }, 'count'])

    await result.act(async () => {
      events.dispatchEvent({ countDrafted: 2 })
      await settleEffects()
    })
    // The wildcard reads the composite for every event; occurrences ride along
    // as the matched event instead of replacing the input.
    assert.equal(result.$('[aria-label="snapshot"]')?.textContent, 'count:1 raw:2')
    assert.deepEqual(seen[seen.length - 1], [{ count: 1 }, 'countDrafted'])
  })

  it('creates typed local-name events', () => {
    let events = createEvents()
    let otherEvents = createEvents()
    let first = events.create({ submitted: { id: 'first' } })
    let second = events.create({ submitted: { id: 'second' } })
    let signal = events.create('paid')

    assert.equal(first.detail.id, 'first')
    assert.equal(signal.detail, null)
    assert.ok(first !== second)
    assert.equal(first.type, second.type)
    assert.equal(first.type, 'submitted')
    assert.equal(first.cancelable, false)
    first.preventDefault()
    assert.equal(first.defaultPrevented, false)
    assert.equal(otherEvents.create({ submitted: { id: 'other' } }).type, 'submitted')
    let target = new EventTarget()
    let observed = false
    target.addEventListener('submitted', () => {
      observed = true
    })
    assert.equal(target.dispatchEvent(first), true)
    assert.equal(observed, true)

    let createWithEventInit = events.create as unknown as (
      input: object,
      init: EventInit,
    ) => CustomEvent
    assert.throws(
      () => createWithEventInit({ submitted: { id: 'runtime-check' } }, { cancelable: true }),
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
      // @ts-expect-error - descriptor events are completed, non-cancelable facts.
      events.create('paid', { cancelable: true })
      // @ts-expect-error - dispatchEvent is self-only; target.dispatchEvent(events.create(...)) for hosted.
      events.dispatchEvent(new EventTarget(), 'submitted')
      // @ts-expect-error - customEvents effects do not expose reentry signals.
      events.on.paid((_event, _signal) => {})
      events.on['*']((event) => {
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
        <section mix={events.asHost()}>
          <evented.output on={events.on.name} aria-label="name">
            {(value, event) => event?.type}
          </evented.output>
          <evented.output on={events.on.length} aria-label="length">
            {(value, event) => event?.type}
          </evented.output>
          <evented.output on={events.on.bind} aria-label="bind">
            {(value, event) => event?.type}
          </evented.output>
          <evented.output on={events.on.toString} aria-label="toString">
            {(value, event) => event?.type}
          </evented.output>
        </section>
      )
    }

    let result = render(<CollidingEventNames />)
    t.after(() => result.cleanup())
    let section = result.$('section') as HTMLElement

    await result.act(async () => {
      section.dispatchEvent(events.create({ name: null, length: null, bind: null, toString: null }))
    })

    for (let type of ['name', 'length', 'bind', 'toString']) {
      assert.equal(result.$(`[aria-label="${type}"]`)?.textContent, type)
    }
  })

  it('updates reactive props and children before running DOM effects', async (t) => {
    let events = createEvents()

    function Checkout() {
      return () => (
        <section mix={events.asHost()}>
          <button
            aria-label="submit"
            mix={on('click', ({ currentTarget }) => {
              currentTarget.dispatchEvent(events.create({ submitted: { id: 'order-1' } }))
            })}
          >
            Submit
          </button>
          <evented.form
            on={events.on.submitted}
            initial={events.create({ submitted: { id: 'idle' } })}
            aria-label="form"
            class={(order, event) => (order?.id === 'idle' ? '' : 'pending')}
            aria-busy={(order, event) => order?.id !== 'idle'}
            mix={events.on.submitted(({ currentTarget }) => {
              currentTarget.dataset.committed = String(currentTarget.classList.contains('pending'))
            })}
          >
            {(order, event) => <output>{order?.id}</output>}
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
        <section mix={events.asHost()} aria-label="confirmation-host">
          <evented.output
            on={events.on.submitted}
            hidden={(order, event) => order === undefined}
            aria-label="confirmation"
          >
            {(order, event) => order?.id ?? null}
          </evented.output>
          <evented.output
            on={events.on.submitted}
            initial={events.create({ submitted: { id: 'initial' } })}
            hidden={(order, event) => order?.id === 'hidden'}
            aria-label="initial-confirmation"
          >
            {(order, event) => order?.id}
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

    await result.act(() => host.dispatchEvent(events.create({ submitted: { id: 'order-1' } })))
    assert.equal(confirmation.hidden, false)
    assert.equal(confirmation.textContent, 'order-1')
  })

  it('commits the source view before downstream views', async (t) => {
    let events = createEvents()

    function Form() {
      return () => (
        <evented.form
          on={events}
          aria-label="source"
          data-action={(value, event) => event?.type}
          mix={[
            events.asHost(),
            on('focusout', ({ currentTarget }) => {
              currentTarget.dataset.actionSeenOnFocusout = currentTarget.dataset.action ?? 'missing'
            }),
          ]}
        >
          <evented.input
            on={events}
            aria-label="input"
            disabled={(value, event) => event?.type === 'submitted'}
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
      form.dispatchEvent(events.create({ submitted: { id: 'order-1' } }))
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
        <section mix={events.asHost()}>
          <button
            aria-label="update"
            mix={on('click', ({ currentTarget }) => {
              currentTarget.dispatchEvent(events.create({ submitted: { id: 'first' } }))
            })}
          />
          {['first', 'second'].map((id) => (
            <evented.output
              on={[events.on.submitted, events.on.paid]}
              initial={initialOutcome}
              aria-label={id}
              mix={events.on['*'](({ currentTarget, type }) => {
                currentTarget.dataset.effect = type
              })}
            >
              {(input, event) => (event.type === 'submitted' ? (input?.[0]?.id ?? '') : 'idle')}
            </evented.output>
          ))}
          <evented.output on={events} initial={initialOutcome} aria-label="all">
            {(value, event) => (event.type === 'paid' ? 'idle' : event.type)}
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

    await result.act(() => {
      let section = result.$('section') as HTMLElement
      section.dispatchEvent(events.create({ submitted: { id: 'first-again' } }, { composed: true }))
      section.dispatchEvent(events.create({ submitted: { id: 'second' } }, { composed: true }))
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
              events.on.paid(({ currentTarget }) => {
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
              mix={events.on.paid(({ currentTarget }) => {
                currentTarget.textContent = 'received'
              })}
            />
          </section>
          <section mix={events.asHost()}>
            <button
              aria-label="hosted-source"
              mix={on('click', ({ currentTarget }) => {
                currentTarget.dispatchEvent(events.create('paid'))
              })}
            />
            <output
              aria-label="hosted-listener"
              mix={events.on.paid(({ currentTarget }) => {
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
            events.asHost(),
            events.on.submitted(({ currentTarget, detail }) => {
              currentTarget.dataset.latest = detail.id
            }),
          ]}
        >
          <form mix={events.asHost()}>
            <button
              aria-label="local"
              mix={on('click', ({ currentTarget }) => {
                currentTarget.dispatchEvent(events.create({ submitted: { id: 'local' } }))
              })}
            />
            <button
              aria-label="composed"
              mix={on('click', ({ currentTarget }) => {
                currentTarget.dispatchEvent(
                  events.create({ submitted: { id: 'composed' } }, { composed: true }),
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
        <section mix={events.asHost()}>
          <button
            aria-label="dispatch"
            mix={ref((button) => {
              dispatchTarget = button
            })}
          />
          <evented.output
            on={events}
            aria-label="view"
            mix={events.on['*'](async ({ type, currentTarget }) => {
              await Promise.resolve()
              effects.push(`${type}:${currentTarget.textContent}`)
            })}
          >
            {(value, event) => event && `${event.type}:${++viewUpdates}`}
          </evented.output>
        </section>
      )
    }

    let result = render(<Transaction />)
    t.after(() => result.cleanup())

    await result.act(() =>
      dispatchTarget.dispatchEvent(events.create({ submitted: { id: 'batched' }, paid: null })),
    )
    await settleEffects()

    assert.equal(result.$('[aria-label="view"]')?.textContent, 'paid:1')
    assert.deepEqual(effects, ['submitted:paid:1', 'paid:paid:1'])
  })

  it('mirrors batch entries only on a bridged domain EventTarget', async () => {
    let domain = new EventTarget()
    let events = createEvents().asHost(domain)
    let nativeCalls: string[] = []
    domain.addEventListener('submitted', (event) => {
      nativeCalls.push(`submitted:${(event as CustomEvent<{ id: string }>).detail.id}`)
    })
    domain.addEventListener('paid', () => nativeCalls.push('paid'))

    domain.dispatchEvent(events.create({ submitted: { id: 'batch' }, paid: null }))
    domain.dispatchEvent(events.create({ paid: null }))
    domain.dispatchEvent(events.create({ paid: null }))

    assert.deepEqual(nativeCalls, ['submitted:batch', 'paid', 'paid', 'paid'])
  })

  it('catches a mount-time event after listener setup', async (t) => {
    let events = createEvents()

    function MountedInput() {
      return () => (
        <input
          aria-label="input"
          mix={[
            events.asHost(),
            on('input', ({ currentTarget }) => {
              currentTarget.dispatchEvent(events.create('paid'))
            }),
            events.on.paid(({ currentTarget }) => {
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

  it('notifies whole-key and addressed subscribers for every event', async () => {
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

    function event(addresses: readonly (readonly string[])[]) {
      return customEventsRuntime.createProductEvent(runtime, 'updated', null, init, [
        {
          type: 'updated',
          detail: null,
          addresses,
        },
      ])
    }

    calls = []
    await customEventsRuntime.dispatch(runtime, origin, event([['circle:1']]))
    assert.deepEqual(calls, ['whole', 'key'])

    calls = []
    await customEventsRuntime.dispatch(runtime, origin, event([['circle:2']]))
    assert.deepEqual(calls, ['whole'])

    calls = []
    await customEventsRuntime.dispatch(runtime, origin, event([[]]))
    assert.deepEqual(calls, ['whole', 'key'])

    // Entries without addresses notify every subscriber.
    calls = []
    await customEventsRuntime.dispatch(runtime, origin, event(undefined as never))
    assert.deepEqual(calls, ['whole', 'key'])

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

describe('remembered customEvents', () => {
  it('folds remembered replaces and fold events into the root composite', async (t) => {
    let events = customEvents({
      root: {
        count: 0,
        label: 'idle',
      },

      inc: (amount: number, root) => {
        root.count += amount
      },
    })
    let seen: Array<[unknown, unknown]> = []

    function View() {
      return () => (
        <evented.output on={events} aria-label="root">
          {(detail, event) => {
            seen.push([detail, event?.type])
            return `${detail.label}:${detail.count}`
          }}
        </evented.output>
      )
    }

    let result = render(<View />)
    t.after(() => result.cleanup())
    assert.equal(result.$('[aria-label="root"]')?.textContent, 'idle:0')

    await result.act(async () => {
      await events.dispatchEvent({ inc: 2 })
      await settleEffects()
    })
    assert.equal(result.$('[aria-label="root"]')?.textContent, 'idle:2')
    // The effect entry notifies the root, then the affected remembered event folds.
    assert.deepEqual(seen[seen.length - 1], [{ count: 2, label: 'idle' }, 'count'])

    await result.act(async () => {
      await events.dispatchEvent({ count: 5, label: 'ready' })
      await settleEffects()
    })
    assert.equal(result.$('[aria-label="root"]')?.textContent, 'ready:5')
    assert.deepEqual(seen[seen.length - 1], [{ count: 5, label: 'ready' }, 'label'])

    if (false) {
      // @ts-expect-error - remembered descriptors have no state namespace.
      events.on.state
      // @ts-expect-error - remembered descriptors have no sync read.
      events.on.value
      // @ts-expect-error - writes go through dispatch, not update.
      events.on.update
      // @ts-expect-error - remembered details are typed by their seeds.
      events.dispatchEvent({ count: 'not-a-number' })
      // @ts-expect-error - seeds cannot overwrite the descriptor API.
      customEvents({ root: { dispatchEvent: 1 } })
      // @ts-expect-error - seeds cannot use native DOM event names.
      customEvents({ root: { click: false } })
    }
  })

  it('dispatches occurrences with and without details', async (t) => {
    let events = customEvents({
      root: {
        count: 0,
      },
      // A declared occurrence with a detail.
      countDrafted: (count: number) => {},
    })
    let seen: Array<[unknown, unknown]> = []

    function View() {
      return () => (
        <evented.output on={events} aria-label="root">
          {(detail, event) => {
            seen.push([detail, event?.type])
            if (event?.type === 'refreshRequested') return `refresh:${detail.count}`
            if (event?.type === 'countDrafted') return `draft:${event.detail}`
            return `count:${detail.count}`
          }}
        </evented.output>
      )
    }

    let result = render(<View />)
    t.after(() => result.cleanup())
    assert.equal(result.$('[aria-label="root"]')?.textContent, 'count:0')

    await result.act(async () => {
      await events.dispatchEvent('refreshRequested')
      await settleEffects()
    })
    assert.equal(result.$('[aria-label="root"]')?.textContent, 'refresh:0')
    assert.deepEqual(seen[seen.length - 1], [{ count: 0 }, 'refreshRequested'])

    await result.act(async () => {
      await events.dispatchEvent({ countDrafted: 42 })
      await settleEffects()
    })
    assert.equal(result.$('[aria-label="root"]')?.textContent, 'draft:42')
    assert.deepEqual(seen[seen.length - 1], [{ count: 0 }, 'countDrafted'])
  })

  it('runs effect folds atomically and routes patches fine-grained', async (t) => {
    type Item = { id: number; label: string }
    let events = customEvents({
      root: {
        items: new Map<number, Item>([[1, { id: 1, label: 'one' }]]),
      },

      rename: ({ id, label }: { id: number; label: string }, root) => {
        let item = root.items.get(id)
        if (!item) return
        root.items.set(id, { ...item, label })
      },
    })
    let rootCalls = 0

    function View() {
      return () => (
        <section>
          <evented.output on={events} aria-label="root">
            {(detail) => {
              rootCalls++
              return `${detail.items.size} items`
            }}
          </evented.output>
          <evented.div on={events.on.items}>
            {(items) => (
              <>
                {[...items.entries()].map(([id, item]) => (
                  <evented.div key={id} className="item" on={events.on.items.get(id)}>
                    {(current) => current?.label ?? item.label}
                  </evented.div>
                ))}
              </>
            )}
          </evented.div>
        </section>
      )
    }

    let result = render(<View />)
    t.after(() => result.cleanup())
    assert.equal(rootCalls, 1)
    let item = result.$('.item')!

    await result.act(async () => {
      await events.dispatchEvent({ rename: { id: 1, label: 'first' } })
      await settleEffects()
    })
    // The effect entry rides the diffed Map item routes, so the whole-key
    // views re-resolve while the item element follows its own keyed route,
    // preserving its DOM identity.
    assert.equal(result.$('[aria-label="root"]')?.textContent, '1 items')
    assert.equal(result.$('.item')?.textContent, 'first')
    assert.equal(result.$('.item'), item)
    assert.equal(rootCalls, 2, `rootCalls=${rootCalls}`)
  })

  it("keeps the fold event's own detail visible to its subscribers", async (t) => {
    let events = customEvents({
      root: {
        elapsed: 0,
      },

      tick: (delta: number, root) => {
        root.elapsed += delta
      },
    })
    let seen: Array<[unknown, unknown]> = []

    function View() {
      return () => (
        <evented.output on={events.on.tick} aria-label="tick">
          {(delta, latest) => {
            seen.push([delta, latest?.type])
            return delta === undefined ? '' : `${delta}`
          }}
        </evented.output>
      )
    }

    let result = render(<View />)
    t.after(() => result.cleanup())
    assert.equal(result.$('[aria-label="tick"]')?.textContent, '')

    await result.act(async () => {
      await events.dispatchEvent({ tick: 0.5 })
      await settleEffects()
    })
    assert.equal(result.$('[aria-label="tick"]')?.textContent, '0.5')
    assert.deepEqual(seen[seen.length - 1], [0.5, 'tick'])
  })

  it('folds null through the bare-name sugar for remembered events', async (t) => {
    let events = customEvents({ root: { kind: 'one-way' } })
    let seen: unknown[] = []

    function View() {
      return () => (
        <evented.output on={events.on.kind} aria-label="kind">
          {(kind) => {
            seen.push(kind)
            return `${kind}`
          }}
        </evented.output>
      )
    }

    let result = render(<View />)
    t.after(() => result.cleanup())
    assert.equal(result.$('[aria-label="kind"]')?.textContent, 'one-way')

    await result.act(async () => {
      await events.dispatchEvent({ kind: 'return' })
      await settleEffects()
    })
    assert.equal(result.$('[aria-label="kind"]')?.textContent, 'return')
  })

  it('keeps remembered seeds live and rejects reserved names', () => {
    let seeds = { count: 0 }
    let events = customEvents({ root: seeds })
    events.dispatchEvent({ count: 1 })
    assert.equal(seeds.count, 1)
    events.dispatchEvent({ root: { count: 2 } })
    assert.equal(seeds.count, 2)
    assert.throws(() => {
      customEvents({ root: Object.freeze({ count: 0 }) })
    }, /must not be frozen/)
    assert.throws(() => {
      customEvents({ root: { on: 1 } } as any)
    }, /reserves the detail name/)
    assert.throws(() => {
      customEvents({ root: { count: 0 }, create: (_detail, root) => {} })
    }, /reserves "create"/)

    let events2 = customEvents({ root: { count: 0 } })
    assert.throws(() => events2.dispatchEvent({ on: 1 } as any), /reserves "on"/)
    assert.throws(() => events2.dispatchEvent({ create: 1 } as any), /reserves "create"/)
    assert.throws(() => events2.dispatchEvent({ root: 5 } as any), /root must be an object/)
    assert.throws(
      () => events2.dispatchEvent({ root: { on: 1 } } as any),
      /reserves the detail name/,
    )
    // Pure descriptors have no composite, so `root` is not writable there.
    let pure = customEvents<'querySubmitted'>()
    assert.throws(() => pure.dispatchEvent({ root: { query: 'x' } } as any), /reserves "root"/)
  })

  it('exposes the root composite as the named events.root source', async (t) => {
    let events = customEvents({
      root: {
        count: 0,
        label: 'idle',
      },
      inc: (amount: number, root) => {
        root.count += amount
      },
    })
    let seen: Array<[unknown, unknown]> = []

    function View() {
      return () => (
        <evented.output on={events.root} aria-label="root">
          {(detail, event) => {
            seen.push([detail, event?.type])
            return `${detail.label}:${detail.count}`
          }}
        </evented.output>
      )
    }

    let result = render(<View />)
    t.after(() => result.cleanup())
    assert.equal(result.$('[aria-label="root"]')?.textContent, 'idle:0')

    await result.act(async () => {
      await events.dispatchEvent('refresh')
      await settleEffects()
    })
    assert.equal(result.$('[aria-label="root"]')?.textContent, 'idle:0')
    assert.deepEqual(seen[seen.length - 1], [{ count: 0, label: 'idle' }, 'refresh'])

    await result.act(async () => {
      await events.dispatchEvent({ inc: 2 })
      await settleEffects()
    })
    assert.equal(result.$('[aria-label="root"]')?.textContent, 'idle:2')
    assert.deepEqual(seen[seen.length - 1], [{ count: 2, label: 'idle' }, 'count'])
  })

  it('lets a fold shadow a same-named root detail', async (t) => {
    let events = customEvents({
      root: {
        count: 0,
        label: 'idle',
      },
      // The fold shadows the count slice: dispatching count runs the recipe
      // instead of the implicit replace-itself fold.
      count: (value: string, root) => {
        root.count = value.length
        root.label = `len:${value}`
      },
    })

    function View() {
      return () => (
        <evented.output on={events} aria-label="root">
          {(detail) => `${detail.label}:${detail.count}`}
        </evented.output>
      )
    }

    let result = render(<View />)
    t.after(() => result.cleanup())
    assert.equal(result.$('[aria-label="root"]')?.textContent, 'idle:0')

    await result.act(async () => {
      await events.dispatchEvent({ count: 'abcd' })
      await settleEffects()
    })
    // The fold ran, not the slice replace: count derived from the detail.
    assert.equal(result.$('[aria-label="root"]')?.textContent, 'len:abcd:4')

    if (false) {
      // @ts-expect-error - the shadowing fold's detail (string) wins over the slice (number).
      events.dispatchEvent({ count: 5 })
    }
  })

  it('derives sibling details through shadowing folds', async (t) => {
    let events = customEvents({
      root: {
        celsius: '',
        fahrenheit: '',
      },
      // Each fold shadows its root detail: dispatching the name runs the
      // recipe instead of the implicit replace-itself fold, so the recipe
      // derives the other unit from the detail.
      celsius: (value: string, root) => {
        root.celsius = value
        let number = Number(value)
        if (Number.isFinite(number) && value.trim() !== '') {
          root.fahrenheit = String(number * (9 / 5) + 32)
        }
      },
      fahrenheit: (value: string, root) => {
        root.fahrenheit = value
        let number = Number(value)
        if (Number.isFinite(number) && value.trim() !== '') {
          root.celsius = String((number - 32) * (5 / 9))
        }
      },
    })

    function View() {
      return () => (
        <evented.output on={events} aria-label="root">
          {(detail) => `${detail.celsius}/${detail.fahrenheit}`}
        </evented.output>
      )
    }

    let result = render(<View />)
    t.after(() => result.cleanup())
    // The composite starts from its root data.
    assert.equal(result.$('[aria-label="root"]')?.textContent, '/')

    await result.act(async () => {
      await events.dispatchEvent({ celsius: '25' })
      await settleEffects()
    })
    // The celsius fold ran (shadowing the slice) and derived fahrenheit.
    assert.equal(result.$('[aria-label="root"]')?.textContent, '25/77')

    await result.act(async () => {
      await events.dispatchEvent({ fahrenheit: '212' })
      await settleEffects()
    })
    // The fahrenheit fold derived celsius; its own write stands.
    assert.equal(result.$('[aria-label="root"]')?.textContent, '100/212')

    if (false) {
      // @ts-expect-error - the shadowing fold's detail (string) wins over the slice.
      events.dispatchEvent({ celsius: 25 })
    }
  })

  it('declares transient occurrences with a single-parameter recipe', async (t) => {
    let events = customEvents({
      root: {
        count: 0,
      },
      drafted: (text: string) => {},
    })
    let drafts: Array<unknown> = []

    function View() {
      return () => (
        <section>
          <evented.output on={events.on.drafted} aria-label="draft">
            {(draft) => {
              drafts.push(draft)
              return `${draft}`
            }}
          </evented.output>
          <evented.output on={events} aria-label="root">
            {(detail) => `${detail.count}`}
          </evented.output>
        </section>
      )
    }

    let result = render(<View />)
    t.after(() => result.cleanup())
    assert.equal(result.$('[aria-label="root"]')?.textContent, '0')

    await result.act(async () => {
      await events.dispatchEvent({ drafted: 'one' })
      await settleEffects()
    })
    assert.equal(result.$('[aria-label="draft"]')?.textContent, 'one')
    // The occurrence leaves the composite untouched.
    assert.equal(result.$('[aria-label="root"]')?.textContent, '0')

    await result.act(async () => {
      await events.dispatchEvent({ drafted: 'two' })
      await settleEffects()
    })
    assert.equal(result.$('[aria-label="draft"]')?.textContent, 'two')
    assert.deepEqual(drafts.slice(-2), ['one', 'two'])
  })

  it('declares detail-less occurrences with a zero-parameter recipe', async (t) => {
    let events = customEvents({
      root: {
        count: 0,
      },
      bookingConfirmed: () => {},
    })
    let seen: unknown[] = []

    function View() {
      return () => (
        <section>
          <evented.output on={events.on.bookingConfirmed} aria-label="signal">
            {(detail) => {
              seen.push(detail)
              return detail === null ? 'idle' : 'matched'
            }}
          </evented.output>
          <evented.output on={events} aria-label="root">
            {(detail) => `${detail.count}`}
          </evented.output>
        </section>
      )
    }

    let result = render(<View />)
    t.after(() => result.cleanup())
    assert.equal(result.$('[aria-label="root"]')?.textContent, '0')

    await result.act(async () => {
      await events.dispatchEvent('bookingConfirmed')
      await settleEffects()
    })
    assert.equal(result.$('[aria-label="signal"]')?.textContent, 'idle')
    // The detail-less occurrence leaves the composite untouched.
    assert.equal(result.$('[aria-label="root"]')?.textContent, '0')
    assert.deepEqual(seen.slice(-1), [null])
  })

  it('derives details from the composite at dispatch time', async (t) => {
    let events = customEvents({
      root: {
        count: 0,
        label: 'idle',
      },
      inc: (amount: number, root) => {
        root.count += amount
      },
      drafted: (text: string) => {},
    })

    function View() {
      return () => (
        <section>
          <evented.output on={events} aria-label="root">
            {(detail) => `${detail.label}:${detail.count}`}
          </evented.output>
          <evented.output on={events.on.drafted} aria-label="draft">
            {(draft) => `${draft}`}
          </evented.output>
        </section>
      )
    }

    let result = render(<View />)
    t.after(() => result.cleanup())
    assert.equal(result.$('[aria-label="root"]')?.textContent, 'idle:0')

    if (false) {
      // @ts-expect-error - derived-detail callbacks read the composite readonly.
      events.dispatchEvent({ count: (root) => (root.count = 1) })
    }

    // A derived occurrence detail: computed from the live composite at dispatch.
    await result.act(async () => {
      await events.dispatchEvent({ drafted: (root) => `count=${root.count}` })
      await settleEffects()
    })
    assert.equal(result.$('[aria-label="draft"]')?.textContent, 'count=0')

    // Derived slice and fold details, in transaction order: the later
    // callback sees the earlier entry's effect.
    await result.act(async () => {
      await events.dispatchEvent({
        count: (root) => root.count + 1,
        inc: (root) => root.count,
      })
      await settleEffects()
    })
    assert.equal(result.$('[aria-label="root"]')?.textContent, 'idle:2')

    // A derived root write replaces the composite with the returned model.
    await result.act(async () => {
      await events.dispatchEvent({
        root: (root) => ({ count: root.count * 10, label: 'derived' }),
      })
      await settleEffects()
    })
    assert.equal(result.$('[aria-label="root"]')?.textContent, 'derived:20')

    // Derived details require a composite: pure descriptors reject them.
    let pure = customEvents<'ping'>()
    assert.throws(() => pure.dispatchEvent({ ping: () => 1 } as any), /remembered descriptor/)
  })

  it('replaces the whole composite via a root write', async (t) => {
    let events = customEvents({
      root: {
        count: 0,
        label: 'idle',
      },
      inc: (amount: number, root) => {
        root.count += amount
      },
    })

    function View() {
      return () => (
        <evented.output on={events} aria-label="root">
          {(detail) => `${detail.label}:${detail.count}`}
        </evented.output>
      )
    }

    let result = render(<View />)
    t.after(() => result.cleanup())
    assert.equal(result.$('[aria-label="root"]')?.textContent, 'idle:0')

    await result.act(async () => {
      await events.dispatchEvent({ root: { count: 5, label: 'ready' } })
      await settleEffects()
    })
    assert.equal(result.$('[aria-label="root"]')?.textContent, 'ready:5')

    // A root write replaces the composite wholesale: slices it omits are gone.
    await result.act(async () => {
      await events.dispatchEvent({ root: { count: 7 } } as any)
      await settleEffects()
    })
    assert.equal(result.$('[aria-label="root"]')?.textContent, 'undefined:7')

    // The composite is replaced before later entries in the same transaction.
    await result.act(async () => {
      await events.dispatchEvent({ root: { count: 1, label: 'folded' }, inc: 2 })
      await settleEffects()
    })
    assert.equal(result.$('[aria-label="root"]')?.textContent, 'folded:3')

    // The built event carries the composite as the root event's detail.
    await result.act(async () => {
      await events.dispatchEvent(events.create({ root: { count: 9, label: 'built' } }))
      await settleEffects()
    })
    assert.equal(result.$('[aria-label="root"]')?.textContent, 'built:9')
  })

  it('reads and routes deep number-keyed collections by canonical segment', async (t) => {
    let events = customEvents({
      root: {
        boards: new Map([
          [
            1,
            {
              cards: new Map([
                [10, { label: 'ten' }],
                [20, { label: 'twenty' }],
              ]),
            },
          ],
        ]),
      },
      rename: (id: number, root) => {
        let card = root.boards.get(1)?.cards.get(id)
        if (card) card.label = `${card.label}!`
      },
    })
    let calls = { board: 0, ten: 0, twenty: 0 }

    function Board() {
      return () => (
        <section>
          <evented.output on={events.on.boards}>
            {() => String(++calls.board)}
          </evented.output>
          <evented.output on={events.on.boards.get(1).cards.get(10).label}>
            {() => String(++calls.ten)}
          </evented.output>
          <evented.output on={events.on.boards.get(1).cards.get(20).label}>
            {() => String(++calls.twenty)}
          </evented.output>
        </section>
      )
    }

    let result = render(<Board />)
    t.after(() => result.cleanup())
    assert.deepEqual(calls, { board: 1, ten: 1, twenty: 1 })

    // A deep recipe write reaches only the addressed card and the whole-key
    // view, resolving through number keys by their canonical string form.
    await result.act(async () => {
      await events.dispatchEvent({ rename: 10 })
      await settleEffects()
    })
    assert.deepEqual(calls, { board: 2, ten: 2, twenty: 1 })

    await result.act(async () => {
      await events.dispatchEvent({ rename: 20 })
      await settleEffects()
    })
    assert.deepEqual(calls, { board: 3, ten: 2, twenty: 2 })
  })
})
