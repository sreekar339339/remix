import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { on, ref, type Handle } from 'remix/ui'
import { renderToString } from 'remix/ui/server'
import { render } from 'remix/ui/test'
import { Events, evented as e } from './index.tsx'
import { customEventsRuntime } from './runtime.ts'
import { createEvents, settleEffects } from './customEvents.test-utils.tsx'

describe('customEvents', () => {
  it('caches evented components with typed callback inputs', async (t) => {
    let events = createEvents()
    assert.equal(e.output, e.output)
    assert.equal(e.button, e.button)
    assert.equal(typeof e.div, 'function')

    function AliasView() {
      return () => (
        <section mix={events.asHost()}>
          <e.output
            on={events.on.submitted}
            aria-label="typed"
            data-id={(order) => order?.id}
          >
            {(order) => order?.id ?? ''}
          </e.output>
          <e.output on={events.on['*']} aria-label="wildcard">
            {(value, event) => (event ? event.type : '')}
          </e.output>
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

  it('replaces a mounted view\'s selector subscriptions when its on prop changes', async (t) => {
    class __SwitchEvents extends Events {
      first = 'first'
      second = 'second'
      setFirst(value: string) {
        this.first = value
      }
      setSecond(value: string) {
        this.second = value
      }
    }
    let events = __SwitchEvents.define()

    function Switcher(handle: Handle) {
      let useFirst = true
      return () => (
        <section mix={events.asHost()}>
          <button
            aria-label="switch"
            mix={on('click', () => {
              useFirst = false
              handle.update()
            })}
          />
          <e.output on={useFirst ? events.on.first : events.on.second} aria-label="value">
            {(value) => value}
          </e.output>
        </section>
      )
    }

    let result = render(<Switcher />)
    t.after(() => result.cleanup())
    let value = () => result.$('[aria-label="value"]')?.textContent
    assert.equal(value(), 'first')

    await result.act(() => (result.$('[aria-label="switch"]') as HTMLButtonElement).click())
    assert.equal(value(), 'second')

    await result.act(async () => {
      await events.dispatchEvent({ setFirst: 'stale' })
      await events.dispatchEvent({ setSecond: 'current' })
    })
    assert.equal(value(), 'current')
  })

  it('renders remembered selector values on the server', async () => {
    class __ServerEvents extends Events {
      label = 'server value'
    }
    let events = __ServerEvents.define()

    let html = await renderToString(
      <e.output on={events.on.label} data-label={(label) => label}>
        {(label) => label}
      </e.output>,
    )

    assert.match(html, /<output data-label="server value">server value<\/output>/)
    assert.ok(!/\s(?:on|initial)=/.test(html))
  })

  it('routes Map and Set folds to item and whole-key subscribers', async (t) => {
    class __CollectionsEvents extends Events {
      position = new Map([
        ['a', 'X'],
        ['b', 'O'],
      ])
      selected = new Set(['red'])
      set({ key, value }: { key: string; value: string }) {
        this.position.set(key, value)
      }
      add(value: string) {
        this.selected.add(value)
      }
    }
    let events = __CollectionsEvents.define()
    let calls = { mapA: 0, mapB: 0, mapAll: 0, red: 0, blue: 0 }
    let positionEvents = 0
    events.addEventListener('position', () => positionEvents++)

    function Collections() {
      return () => (
        <section>
          <e.output on={events.on.position.get('a')}>
            {(mark) => `${++calls.mapA}:${mark ?? ''}`}
          </e.output>
          <e.output on={events.on.position.get('b')}>
            {(mark) => `${++calls.mapB}:${mark ?? ''}`}
          </e.output>
          <e.output on={events.on.position}>
            {(positions) => `${++calls.mapAll}:${positions.size}`}
          </e.output>
          <e.output on={events.on.selected.has('red')}>
            {(selected) => `${++calls.red}:${selected}`}
          </e.output>
          <e.output on={events.on.selected.has('blue')}>
            {(selected) => `${++calls.blue}:${selected}`}
          </e.output>
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
    class __CanvasEvents extends Events {
      circles = new Map<number, { id: number; x: number; r: number }>([
        [1, { id: 1, x: 10, r: 5 }],
        [2, { id: 2, x: 20, r: 5 }],
      ])
      resize({ id, r }: { id: number; r: number }) {
        let circle = this.circles.get(id)
        if (circle) circle.r = r
      }
      add(circle: { id: number; x: number; r: number }) {
        this.circles.set(circle.id, circle)
      }
      replace(circles: Map<number, { id: number; x: number; r: number }>) {
        this.circles = circles
      }
    }
    let events = __CanvasEvents.define()
    function Canvas() {
      return () => (
        <e.svg on={events.on.circles}>
          {(circles) =>
            [...circles.values()].map((circle) => (
              <e.circle
                key={circle.id}
                on={events.on.circles.get(circle.id).r}
                cx={circle.x}
                r={(radius) => radius ?? circle.r}
              />
            ))
          }
        </e.svg>
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
    class __ReconcileCanvasEvents extends Events {
      circles = new Map<number, { id: number; x: number; r: number }>([
        [1, { id: 1, x: 10, r: 5 }],
        [2, { id: 2, x: 20, r: 5 }],
      ])
      resize({ id, r }: { id: number; r: number }) {
        let circle = this.circles.get(id)
        if (circle) circle.r = r
      }
      add(circle: { id: number; x: number; r: number }) {
        this.circles.set(circle.id, circle)
      }
      remove(id: number) {
        this.circles.delete(id)
      }
    }
    let events = __ReconcileCanvasEvents.define()
    function Canvas() {
      return () => (
        <e.svg on={events.on.circles}>
          {(circles) =>
            [...circles.entries()].map(([id, circle]) => (
              <e.circle
                key={id}
                on={events.on.circles.get(id).r}
                cx={circle.x}
                r={(radius) => radius ?? circle.r}
              />
            ))
          }
        </e.svg>
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
    class __ItemsEvents extends Events {
      items = new Map<number, { id: number; label: string }>([
        [1, { id: 1, label: 'one' }],
        [2, { id: 2, label: 'two' }],
      ])
      add(item: { id: number; label: string }) {
        this.items.set(item.id, item)
      }
      remove(id: number) {
        this.items.delete(id)
      }
    }
    let events = __ItemsEvents.define()
    let viewCalls = 0

    function Items() {
      return () => (
        <section>
          <e.div on={events.on.items}>
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
          </e.div>
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

    // A mixed burst of adds and removals settles on the final detail.
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
    class __BoardEvents extends Events {
      columns = new Map([
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
      ])
      toggle({ columnId, cardId }: { columnId: string; cardId: string }) {
        let card = this.columns.get(columnId)?.cards.get(cardId)
        if (card) card.urgent = !card.urgent
      }
    }
    let events = __BoardEvents.define()
    let calls = { todo: 0, done: 0, one: 0, two: 0, three: 0 }

    function Board() {
      return () => (
        <section>
          <e.output on={events.on.columns.get('column:todo')}>
            {() => String(++calls.todo)}
          </e.output>
          <e.output on={events.on.columns.get('column:done')}>
            {() => String(++calls.done)}
          </e.output>
          <e.output on={events.on.columns.get('column:todo').cards.get('card:one')}>
            {() => String(++calls.one)}
          </e.output>
          <e.output on={events.on.columns.get('column:todo').cards.get('card:two')}>
            {() => String(++calls.two)}
          </e.output>
          <e.output on={events.on.columns.get('column:done').cards.get('card:three')}>
            {() => String(++calls.three)}
          </e.output>
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
    class __RecordEvents extends Events {
      records = new Map<object, { value: number }>([[recordKey, { value: 1 }]])
      set({ key, value }: { key: object; value: number }) {
        let record = this.records.get(key)
        if (record) record.value = value
      }
    }
    let events = __RecordEvents.define()
    let renders = 0

    function RecordValue() {
      return () => (
        <e.output on={events.on.records.get(recordKey).value}>
          {(value) => `${++renders}:${value}`}
        </e.output>
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
    class __ArrayItemsEvents extends Events {
      items = ['first', 'second']
      set({ index, value }: { index: number; value: string }) {
        this.items[index] = value
      }
      removeFirst() {
        this.items.splice(0, 1)
      }
      replace(items: string[]) {
        this.items = items
      }
    }
    let events = __ArrayItemsEvents.define()
    let calls = { first: 0, second: 0, all: 0 }

    function Items() {
      return () => (
        <section>
          <e.output on={events.on.items[0]}>{() => String(++calls.first)}</e.output>
          <e.output on={events.on.items[1]} aria-label="1">
            {() => String(++calls.second)}
          </e.output>
          <e.output on={events.on.items}>{() => String(++calls.all)}</e.output>
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
    class __ArrayCirclesEvents extends Events {
      circles: Circle[] = [
        { id: 7, diameter: 30 },
        { id: 8, diameter: 40 },
      ]
      values = { A0: '10', B0: '20' }
      resize({ index, diameter }: { index: number; diameter: number }) {
        let circle = this.circles[index]
        if (circle) circle.diameter = diameter
      }
      setValue({ key, value }: { key: string; value: string }) {
        ;(this.values as Record<string, string>)[key] = value
      }
      removeFirst() {
        this.circles.splice(0, 1)
      }
      replace(circles: Circle[]) {
        this.circles = circles
      }
    }
    let events = __ArrayCirclesEvents.define()
    let calls = { circle0: 0, circle1: 0, A0: 0, B0: 0 }

    function Collections() {
      return () => (
        <section>
          <e.output on={events.on.circles[0]}>{() => String(++calls.circle0)}</e.output>
          <e.output on={events.on.circles[1]} aria-label="1">
            {() => String(++calls.circle1)}
          </e.output>
          <e.output on={events.on.values.A0}>{() => String(++calls.A0)}</e.output>
          <e.output on={events.on.values.B0}>{() => String(++calls.B0)}</e.output>
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
    class __SelectionEvents extends Events {
      selected: string | null = null
      select(id: string | null) {
        this.selected = id
      }
    }
    let events = __SelectionEvents.define()
    let calls = { first: 0, second: 0, all: 0 }
    let effectOrder: string[] = []

    function Selection() {
      return () => (
        <section>
          <e.button
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
          </e.button>
          <e.button
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
          </e.button>
          <e.output on={events.on.selected}>{() => String(++calls.all)}</e.output>
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
    class __EditorEvents extends Events {
      count = 0
      increment(amount: number) {
        this.count += amount
      }
      countDrafted(detail: number) {}
    }
    let events = __EditorEvents.define()
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
          <e.output aria-label="listener" on={events.on.countDrafted}>
            {(count) => {
              listenerRenders++
              return `${count}`
            }}
          </e.output>
        </section>
      )
    }

    let result = render(<Editor />)
    t.after(() => result.cleanup())
    let source = result.$('[aria-label="source"]') as HTMLButtonElement
    let listener = result.$('[aria-label="listener"]') as HTMLOutputElement
    let rendersAtElementDispatch = listenerRenders

    await result.act(() => source.click())
    await settleEffects()
    assert.equal(drafts, 1)
    // The element-dispatched event stays on the origin: the descriptor's
    // listener was never told, so its view did not re-render.
    assert.equal(listenerRenders, rendersAtElementDispatch)

    await result.act(async () => {
      events.dispatchEvent({ countDrafted: 2 })
      await settleEffects()
    })
    assert.equal(listenerRenders, rendersAtElementDispatch + 1)
    assert.equal(result.$('[aria-label="listener"]')?.textContent, '2')
  })

  it('renders the whole composite through the wildcard source', async (t) => {
    class __SnapshotEvents extends Events {
      count = 0
      increment(amount: number) {
        this.count += amount
      }
      countDrafted(detail: number) {}
    }
    let events = __SnapshotEvents.define()
    let seen: Array<[{ count: number }, unknown]> = []

    function Snapshot() {
      return () => (
        <e.output on={events.on['*']} aria-label="composite">
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
        </e.output>
      )
    }

    let result = render(<Snapshot />)
    t.after(() => result.cleanup())

    assert.equal(result.$('[aria-label="composite"]')?.textContent, 'count:0')
    assert.equal(seen.length, 1)
    assert.equal(seen[0]?.[0]?.count, 0)
    assert.equal(seen[0]?.[1], undefined)

    await result.act(async () => {
      await events.dispatchEvent({ increment: 1 })
      await settleEffects()
    })
    assert.equal(result.$('[aria-label="composite"]')?.textContent, 'count:1')
    assert.equal((seen[seen.length - 1]![0] as { count: number }).count, 1)
    assert.equal(seen[seen.length - 1]![1], 'count')

    await result.act(async () => {
      events.dispatchEvent({ countDrafted: 2 })
      await settleEffects()
    })
    // The wildcard reads the composite for every event; occurrences ride along
    // as the matched event instead of replacing the input.
    assert.equal(result.$('[aria-label="composite"]')?.textContent, 'count:1 raw:2')
    assert.equal((seen[seen.length - 1]![0] as { count: number }).count, 1)
    assert.equal(seen[seen.length - 1]![1], 'countDrafted')
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
      // @ts-expect-error - descriptor events are completed, non-cancelable facts.
      events.create('paid', { cancelable: true })
      // @ts-expect-error - dispatchEvent is self-only; target.dispatchEvent(events.create(...)) for hosted.
      events.dispatchEvent(new EventTarget(), 'submitted')
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
})
