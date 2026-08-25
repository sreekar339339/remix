import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { render } from 'remix/ui/test'
import { Events, evented as e, type EventsApi } from './index.tsx'

async function settleEffects() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('reactions', () => {
  it('fires a reaction on a slice dispatch, writes the implied slice, and routes derivations', async (t) => {
    class __TempEvents extends Events {
      celsius = ''
      fahrenheit = ''
      constructor(api: EventsApi<__TempEvents>) {
    super()
        api.on.celsius(function ({ detail }) {
          calls.push(`celsius=${detail}`)
          let number = Number(detail)
          if (Number.isFinite(number) && detail.trim() !== '') {
            this.fahrenheit = String((number * 9) / 5 + 32)
          }
        })
      }
    }
    let calls: string[] = []
    let events = __TempEvents.define()

    function View() {
      return () => (
        <section>
          <e.output on={events.on.fahrenheit} aria-label="out">
            {(value) => value ?? ''}
          </e.output>
        </section>
      )
    }
    let result = render(<View />)
    t.after(() => result.cleanup())
    assert.equal(result.$('[aria-label="out"]')?.textContent, '')

    await result.act(async () => {
      await events.dispatchEvent({ celsius: '25' })
      await settleEffects()
    })
    assert.deepEqual(calls, ['celsius=25'])
    assert.equal(result.$('[aria-label="out"]')?.textContent, '77')
    assert.equal(events.detail.celsius, '25')
    assert.equal(events.detail.fahrenheit, '77')

    // A same-value dispatch changes nothing, so the reaction does not fire.
    await result.act(async () => {
      await events.dispatchEvent({ celsius: '25' })
      await settleEffects()
    })
    assert.deepEqual(calls, ['celsius=25'])
    assert.equal(events.detail.fahrenheit, '77')
  })

  it('fires a reaction for every matching reaction, in registration order', async (t) => {
    class __MultiEvents extends Events {
      count = 0
      label = ''
      constructor(api: EventsApi<__MultiEvents>) {
    super()
        api.on.count(function ({ detail }) {
          calls.push(`one=${detail}`)
          this.label = 'one'
        })
        api.on.count(function ({ detail }) {
          calls.push(`two=${detail}`)
          this.label = this.label + '+two'
        })
      }
    }
    let calls: string[] = []
    let events = __MultiEvents.define()
    await events.dispatchEvent({ count: 1 })
    await settleEffects()
    assert.deepEqual(calls, ['one=1', 'two=1'])
    assert.equal(events.detail.label, 'one+two')
  })

  it('routes a deep reaction to the addressed item with change detection', async (t) => {
    class __DeepEvents extends Events {
      boards = new Map<number, { cards: Map<number, { label: string }> }>()
      rename({ id, label }: { id: number; label: string }) {
        let card = this.boards.get(1)?.cards.get(id)
        if (card) card.label = label
      }
      constructor(api: EventsApi<__DeepEvents>) {
    super()
        // The chain is fully typed: the callback binds this to the card's
        // draft and the event detail is the card value (undefined when the
        // item was removed, which is a change at the path too).
        api.on.boards.get(1).cards.get(10)(function ({ detail }) {
          if (detail) {
            calls.push(`card=${detail.label}`)
            this.label = `${this.label}!`
          }
        })
      }
    }
    let calls: string[] = []
    let events = __DeepEvents.define()

    function View() {
      return () => (
        <section>
          <e.output on={events.on.boards.get(1).cards.get(10).label} aria-label="card">
            {(label) => label ?? ''}
          </e.output>
        </section>
      )
    }
    let result = render(<View />)
    t.after(() => result.cleanup())
    assert.equal(result.$('[aria-label="card"]')?.textContent, '')

    let boards = new Map([
      [1, { cards: new Map([[10, { label: 'first' }], [20, { label: 'other' }]]) }],
    ])
    await result.act(async () => {
      await events.dispatchEvent({ boards })
      await settleEffects()
    })
    assert.deepEqual(calls, ['card=first'])
    assert.equal(result.$('[aria-label="card"]')?.textContent, 'first!')

    // A write below a sibling address does not reach this reaction.
    await result.act(async () => {
      await events.dispatchEvent({ rename: { id: 20, label: 'changed' } })
      await settleEffects()
    })
    assert.deepEqual(calls, ['card=first'])

    // A write at the addressed item fires it again with the fresh value.
    await result.act(async () => {
      await events.dispatchEvent({ rename: { id: 10, label: 'second' } })
      await settleEffects()
    })
    assert.deepEqual(calls, ['card=first', 'card=second'])
  })

  it('fires a wildcard reaction on any field dispatch', async (t) => {
    class __WildEvents extends Events {
      a = ''
      b = ''
      constructor(api: EventsApi<__WildEvents>) {
    super()
        api.on['*'](function ({ type }) {
          calls.push(type)
        })
      }
    }
    let calls: string[] = []
    let events = __WildEvents.define()
    await events.dispatchEvent({ a: '1' })
    await settleEffects()
    await events.dispatchEvent({ b: '2' })
    await settleEffects()
    assert.deepEqual(calls, ['a', 'b'])
  })

  it('accepts machinery-named fields without reserving names', async () => {
    class __OwnFieldEvents extends Events {
      count = 0
      dispatchEvent = 'mine'
      constructor(api: EventsApi<__OwnFieldEvents>) {
    super()
        api.on.count(function ({ detail }) {
          this.count = detail
        })
      }
    }
    let events = __OwnFieldEvents.define()
    await events.dispatchEvent({ count: 2 })
    assert.equal(events.detail.count, 2)
    // The class declares the field freely — nothing is reserved — and the
    // six machinery names win on the host.
    assert.equal(typeof events.dispatchEvent, 'function')
  })

  it('fires reactions from fold writes too, with the folded slice value', async (t) => {
    class __FoldEvents extends Events {
      count = 0
      inc(amount: number) {
        this.count += amount
      }
      constructor(api: EventsApi<__FoldEvents>) {
    super()
        api.on.count(function ({ detail }) {
          calls.push(`count=${detail}`)
        })
      }
    }
    let calls: string[] = []
    let events = __FoldEvents.define()
    await events.dispatchEvent({ inc: 2 })
    await settleEffects()
    assert.deepEqual(calls, ['count=2'])
    assert.equal(events.detail.count, 2)
  })

  it('throws on runaway reaction cycles instead of looping forever', async (t) => {
    class __PingPongEvents extends Events {
      kick = 0
      a = 0
      b = 0
      constructor(api: EventsApi<__PingPongEvents>) {
        super()
        // Neither `a` nor `b` is the dispatched field, so neither is ever
        // suppressed — the two feed each other and never converge.
        api.on.kick(function ({ detail }) {
          this.a = detail
        })
        api.on.a(function () {
          this.b += 1
        })
        api.on.b(function () {
          this.a += 2
        })
      }
    }
    let events = __PingPongEvents.define()
    assert.throws(() => events.dispatchEvent({ kick: 1 }), /possible cycle/)
  })

  it('routes fold-cross writes from a reaction through the session', async (t) => {
    class __FoldCrossEvents extends Events {
      count = 0
      doubled = 0
      double(amount: number) {
        this.doubled = amount * 2
      }
      constructor(api: EventsApi<__FoldCrossEvents>) {
    super()
        api.on.count(function ({ detail }) {
          this.doubled = detail
        })
      }
    }
    let events = __FoldCrossEvents.define()
    await events.dispatchEvent({ count: 3 })
    await settleEffects()
    assert.equal(events.detail.count, 3)
    assert.equal(events.detail.doubled, 3)

    await events.dispatchEvent({ double: 4 })
    await settleEffects()
    assert.equal(events.detail.doubled, 8)
    assert.equal(events.detail.count, 3)
  })
})