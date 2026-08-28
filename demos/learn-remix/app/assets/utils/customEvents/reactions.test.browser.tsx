import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { ref } from 'remix/ui'
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
    assert.equal(events.details.celsius, '25')
    assert.equal(events.details.fahrenheit, '77')

    // A same-value dispatch changes nothing, so the reaction does not fire.
    await result.act(async () => {
      await events.dispatchEvent({ celsius: '25' })
      await settleEffects()
    })
    assert.deepEqual(calls, ['celsius=25'])
    assert.equal(events.details.fahrenheit, '77')
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
    assert.equal(events.details.label, 'one+two')
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
    assert.equal(events.details.count, 2)
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
    assert.equal(events.details.count, 2)
  })

  it('runs each reaction at most once per dispatch, converging instead of cycling', async () => {
    let fires = { kick: 0, a: 0, b: 0 }
    class __PingPongEvents extends Events {
      kick = 0
      a = 0
      b = 0
      constructor(api: EventsApi<__PingPongEvents>) {
        super()
        // The two feed each other: kick → a → b → a … The cascade stays
        // linear — each reaction fires at most once per dispatch, and the
        // would-be cycle only updates the event detail.
        api.on.kick(function ({ detail }) {
          fires.kick++
          this.a = detail
        })
        api.on.a(function () {
          fires.a++
          this.b += 1
        })
        api.on.b(function () {
          fires.b++
          this.a += 2
        })
      }
    }
    let events = __PingPongEvents.define()
    await events.dispatchEvent({ kick: 1 })
    // kick fired once; its write routed a's reaction once; a's write routed
    // b's reaction once; b's write routed back to a — already fired this
    // session, so the detail updated (1 + 2) without re-running a's reaction.
    assert.deepEqual({ ...fires }, { kick: 1, a: 1, b: 1 })
    assert.equal(events.details.a, 3)
    assert.equal(events.details.b, 1)
    assert.equal(events.details.kick, 1)

    // A fresh dispatch runs the reactions again (new session, new visits).
    await events.dispatchEvent({ kick: 5 })
    assert.deepEqual({ ...fires }, { kick: 2, a: 2, b: 2 })
    assert.equal(events.details.a, 7)
    assert.equal(events.details.b, 2)
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
    assert.equal(events.details.count, 3)
    assert.equal(events.details.doubled, 3)

    await events.dispatchEvent({ double: 4 })
    await settleEffects()
    assert.equal(events.details.doubled, 8)
    assert.equal(events.details.count, 3)
  })

  it('builds hosted events with api.create inside a reaction callback', async (t) => {
    class __CreateEvents extends Events {
      query = ''
      result = ''
      input: Element | undefined
      constructor({ on, create }: EventsApi<__CreateEvents>) {
        super()
        // The created event folds the result slice eagerly; dispatching it
        // on the hosted input routes the delivery inside the host scope.
        on.query(function ({ detail }) {
          this.input?.dispatchEvent(create({ result: `results for ${detail}` }))
        })
      }
    }
    let events = __CreateEvents.define()
    let input: Element | undefined
    let effectTarget: Element | undefined

    function View() {
      return () => (
        <section>
          <div mix={events.asHost()}>
            <input
              aria-label="in"
              mix={[
                ref((node) => {
                  input = node
                  events.dispatchEvent({ input: node })
                }),
                events.on.result(({ currentTarget }) => {
                  effectTarget = currentTarget
                }),
              ]}
            />
            <e.output on={events.on.result} aria-label="out">
              {(value) => value ?? ''}
            </e.output>
          </div>
        </section>
      )
    }
    let result = render(<View />)
    t.after(() => result.cleanup())
    assert.equal(result.$('[aria-label="out"]')?.textContent, '')

    await result.act(async () => {
      await events.dispatchEvent({ query: 'remix' })
      await settleEffects()
    })
    assert.equal(result.$('[aria-label="out"]')?.textContent, 'results for remix')
    assert.equal(events.details.query, 'remix')
    assert.equal(events.details.result, 'results for remix')
    assert.equal(effectTarget, input)
  })

  it('builds events from an async reaction continuation after the fold session settles', async (t) => {
    class __AsyncCreateEvents extends Events {
      submitted = ''
      response = ''
      output: Element | undefined
      constructor({ on, create }: EventsApi<__AsyncCreateEvents>) {
        super()
        on.submitted(async function ({ detail }, signal) {
          // The continuation resumes after the session committed, so the
          // created event folds onto the committed composite.
          await Promise.resolve()
          if (signal?.aborted) return
          this.output?.dispatchEvent(create({ response: `ack ${detail}` }))
        })
      }
    }
    let events = __AsyncCreateEvents.define()

    function View() {
      return () => (
        <section>
          <div mix={events.asHost()}>
            <div
              aria-label="host"
              mix={ref((node) => events.dispatchEvent({ output: node }))}
            />
            <e.output on={events.on.response} aria-label="out">
              {(value) => value ?? ''}
            </e.output>
          </div>
        </section>
      )
    }
    let result = render(<View />)
    t.after(() => result.cleanup())

    await result.act(async () => {
      await events.dispatchEvent({ submitted: 'go' })
      await new Promise((resolve) => setTimeout(resolve, 0))
      await settleEffects()
    })
    assert.equal(result.$('[aria-label="out"]')?.textContent, 'ack go')
    assert.equal(events.details.response, 'ack go')
  })

  it('keeps an owned publish alive: a reaction publishing back to its own source is not aborted', async (t) => {
    class __PublishEvents extends Events {
      view = 'empty'
      input: Element | undefined
      constructor({ on, create }: EventsApi<__PublishEvents>) {
        super()
        on.view(async function ({ detail }, signal) {
          if (detail !== 'go') return
          await Promise.resolve()
          // Publishing back to the reaction's own source folds that write
          // inside this run; the refire must cascade within the living run,
          // not abort it and discard its result.
          this.input?.dispatchEvent(create({ view: `done:${detail}` }, { signal }))
          assert.ok(signal instanceof AbortSignal)
          assert.ok(!signal.aborted, 'own publish must not abort the run')
        })
      }
    }
    let events = __PublishEvents.define()

    function View() {
      return () => (
        <section>
          <div mix={events.asHost()}>
            <div
              aria-label="host"
              mix={ref((node) => events.dispatchEvent(events.create({ input: node })))}
            />
            <e.output on={events.on.view} aria-label="out">
              {(view) => view}
            </e.output>
          </div>
        </section>
      )
    }
    let result = render(<View />)
    t.after(() => result.cleanup())
    await result.act(async () => {
      await events.dispatchEvent({ view: 'go' })
      await new Promise((resolve) => setTimeout(resolve, 0))
      await settleEffects()
    })
    assert.equal(result.$('[aria-label="out"]')?.textContent, 'done:go')
    assert.equal(events.details.view, 'done:go')
  })

  it('commits a field write before a nested fold fires from its reaction', async () => {
    class __NestedEvents extends Events {
      input: string | undefined
      view = ''
      seenAtViewFire: string | undefined
      constructor({ on, create }: EventsApi<__NestedEvents>) {
        super()
        on.input(function ({ detail }) {
          // Building the event folds the view slice eagerly — a synchronous
          // nested fold while the outer session still holds the input write
          // as an uncommitted draft mutation.
          void create({ view: `view:${detail}` })
        })
        on.view(function ({ detail }) {
          this.seenAtViewFire = this.input
          this.view = detail
        })
      }
    }
    let events = __NestedEvents.define()
    await events.dispatchEvent({ input: 'node' })
    await settleEffects()
    assert.equal(events.details.input, 'node')
    assert.equal(events.details.view, 'view:node')
    assert.equal(events.details.seenAtViewFire, 'node')
  })

  it('updates a hosted view when a reaction derives a slice from a descriptor dispatch', async (t) => {
    class __DeriveEvents extends Events {
      query = ''
      view = ''
      constructor({ on }: EventsApi<__DeriveEvents>) {
        super()
        on.query(function ({ detail }) {
          this.view = `view:${detail}`
        })
      }
    }
    let events = __DeriveEvents.define()

    function View() {
      return () => (
        <section>
          <div mix={events.asHost()}>
            <e.output on={events.on.view} aria-label="out">
              {(value) => value}
            </e.output>
          </div>
        </section>
      )
    }
    let result = render(<View />)
    t.after(() => result.cleanup())
    assert.equal(result.$('[aria-label="out"]')?.textContent, '')

    // The query dispatch originates on the descriptor; the derived view
    // write rides the same carrier into the element host scope.
    await result.act(async () => {
      await events.dispatchEvent({ query: 'a' })
      await settleEffects()
    })
    assert.equal(result.$('[aria-label="out"]')?.textContent, 'view:a')
  })

  it('drops writes from an aborted run so stale continuations cannot clobber newer state', async (t) => {
    let resolvers = new Map<string, () => void>()
    let gate = (key: string) =>
      new Promise<void>((resolve) => resolvers.set(key, resolve))
    class __GateEvents extends Events {
      view = ''
      constructor({ on }: EventsApi<__GateEvents>) {
        super()
        on.view(async function ({ detail }) {
          await gate(detail)
          // No manual guard here: once superseded, this write must be
          // dropped by the runtime.
          this.view = detail
        })
      }
    }
    let events = __GateEvents.define()

    let first = events.dispatchEvent({ view: 'first' })
    await settleEffects()
    let second = events.dispatchEvent({ view: 'second' })
    await settleEffects()

    // The newer run commits first; the stale run resumes afterwards.
    resolvers.get('second')!()
    await second
    resolvers.get('first')!()
    await first
    await settleEffects()
    assert.equal(events.details.view, 'second')
  })

  it('keeps pre-abort writes while dropping post-abort ones in the same run', async (t) => {
    let resolvers = new Map<string, () => void>()
    let gate = (key: string) =>
      new Promise<void>((resolve) => resolvers.set(key, resolve))
    class __PhaseEvents extends Events {
      log: string[] = []
      view = ''
      constructor({ on }: EventsApi<__PhaseEvents>) {
        super()
        on.view(async function ({ detail }) {
          // A fact recorded before the await persists even if superseded.
          this.log = [...this.log, `started:${detail}`]
          await gate(detail)
          this.view = detail
        })
      }
    }
    let events = __PhaseEvents.define()

    let first = events.dispatchEvent({ view: 'first' })
    await settleEffects()
    let second = events.dispatchEvent({ view: 'second' })
    await settleEffects()
    resolvers.get('first')!()
    resolvers.get('second')!()
    await Promise.all([first, second])
    await settleEffects()

    assert.deepEqual(events.details.log, ['started:first', 'started:second'])
    assert.equal(events.details.view, 'second')
  })

  it('gates deep-path reaction writes identically', async (t) => {
    let resolvers = new Map<string, () => void>()
    let gate = (key: string) =>
      new Promise<void>((resolve) => resolvers.set(key, resolve))
    class __DeepGateEvents extends Events {
      boards = new Map<number, { cards: Map<number, { label: string }> }>([
        [1, { cards: new Map([[10, { label: '' }]]) }],
      ])
      rename(label: string) {
        let card = this.boards.get(1)?.cards.get(10)
        if (card) card.label = label
      }
      constructor({ on }: EventsApi<__DeepGateEvents>) {
        super()
        on.boards.get(1).cards.get(10)(async function ({ detail }) {
          await gate(detail!.label)
          this.label = detail!.label
        })
      }
    }
    let events = __DeepGateEvents.define()

    let first = events.dispatchEvent({ rename: 'first' })
    await settleEffects()
    let second = events.dispatchEvent({ rename: 'second' })
    await settleEffects()
    resolvers.get('second')!()
    await second
    resolvers.get('first')!()
    await first
    await settleEffects()
    assert.equal(events.details.boards.get(1)?.cards.get(10)?.label, 'second')
  })

  it('isolates aborted-run rejections from the dispatch settle', async (t) => {
    let resolvers = new Map<string, () => void>()
    let gate = (key: string) =>
      new Promise<void>((resolve) => resolvers.set(key, resolve))
    class __NoiseEvents extends Events {
      view = ''
      constructor({ on }: EventsApi<__NoiseEvents>) {
        super()
        on.view(async function ({ detail }, signal) {
          await gate(detail)
          if (signal?.aborted) throw new DOMException('stale', 'AbortError')
          this.view = detail
        })
      }
    }
    let events = __NoiseEvents.define()

    let failures: unknown[] = []
    let first = events.dispatchEvent({ view: 'first' }).catch((error) => {
      failures.push(error)
    })
    let second = events.dispatchEvent({ view: 'second' }).catch((error) => {
      failures.push(error)
    })
    await settleEffects()
    resolvers.get('first')!()
    resolvers.get('second')!()
    await Promise.all([first, second])
    await settleEffects()
    assert.equal(events.details.view, 'second')
    assert.deepEqual(failures, [])
  })

  it('still propagates genuine reaction failures through the dispatch', async (t) => {
    class __FailEvents extends Events {
      view = ''
      constructor({ on }: EventsApi<__FailEvents>) {
        super()
        on.view(async function ({ detail }) {
          if (detail === 'boom') throw new Error(`boom: ${detail}`)
          this.view = detail
        })
      }
    }
    let events = __FailEvents.define()

    let failure: unknown
    await events.dispatchEvent({ view: 'boom' }).catch((error) => {
      failure = error
    })
    await settleEffects()
    assert.ok(failure instanceof Error)
    assert.match(String(failure), /boom/)
  })
})