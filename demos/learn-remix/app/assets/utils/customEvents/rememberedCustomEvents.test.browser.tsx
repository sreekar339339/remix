import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { render } from 'remix/ui/test'
import { Events, evented, type EventsApi } from './index.tsx'
import { settleEffects } from './customEvents.test-utils.tsx'

describe('remembered customEvents', () => {
  it('folds fold events into the live composite', async (t) => {
    class __RootEvents extends Events {
      count = 0
      label = 'idle'
      inc(amount: number) {
        this.count += amount
      }
    }
    let events = __RootEvents.define()
    let seen: Array<[unknown, unknown]> = []

    function View() {
      return () => (
        <evented.output on={events.on['*']} aria-label="root">
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
    assert.deepEqual({ ...(seen[seen.length - 1]![0] as object) }, { count: 2, label: 'idle' })
    assert.equal(seen[seen.length - 1]![1], 'count')

    await result.act(async () => {
      await events.dispatchEvent({ count: 5, label: 'ready' })
      await settleEffects()
    })
    assert.equal(result.$('[aria-label="root"]')?.textContent, 'ready:5')
    assert.deepEqual({ ...(seen[seen.length - 1]![0] as object) }, { count: 5, label: 'ready' })
    assert.equal(seen[seen.length - 1]![1], 'label')

    if (false) {
      // @ts-expect-error - remembered descriptors have no state namespace.
      events.on.state
      // @ts-expect-error - remembered descriptors have no sync read.
      events.on.value
      // @ts-expect-error - writes go through dispatch, not update.
      events.on.update
      // @ts-expect-error - remembered details are typed by their seeds.
      events.dispatchEvent({ count: 'not-a-number' })
    }
  })

  it('dispatches occurrences with and without details', async (t) => {
    class __DraftedEvents extends Events {
      count = 0
      countDrafted(detail: number) {}
    }
    let events = __DraftedEvents.define()
    let seen: Array<[unknown, unknown]> = []

    function View() {
      return () => (
        <evented.output on={events.on['*']} aria-label="root">
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
    assert.equal((seen[seen.length - 1]![0] as { count: number }).count, 0)
    assert.equal(seen[seen.length - 1]![1], 'refreshRequested')

    await result.act(async () => {
      await events.dispatchEvent({ countDrafted: 42 })
      await settleEffects()
    })
    assert.equal(result.$('[aria-label="root"]')?.textContent, 'draft:42')
    assert.equal((seen[seen.length - 1]![0] as { count: number }).count, 0)
    assert.equal(seen[seen.length - 1]![1], 'countDrafted')
  })

  it('runs effect folds atomically and routes patches fine-grained', async (t) => {
    type Item = { id: number; label: string }
    class __RenameEvents extends Events {
      items = new Map<number, Item>([[1, { id: 1, label: 'one' }]])
      rename({ id, label }: { id: number; label: string }) {
        let item = this.items.get(id)
        if (!item) return
        this.items.set(id, { ...item, label })
      }
    }
    let events = __RenameEvents.define()
    let rootCalls = 0

    function View() {
      return () => (
        <section>
          <evented.output on={events.on['*']} aria-label="root">
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
    class __TickEvents extends Events {
      elapsed = 0
      tick(delta: number) {
        this.elapsed += delta
      }
    }
    let events = __TickEvents.define()
    let seen: Array<[unknown, unknown]> = []

    function View() {
      return () => (
        <evented.output on={events.on['*']} aria-label="tick">
          {(detail, latest) => {
            seen.push([detail.elapsed, latest?.type])
            // The fold event's own detail rides the fold's entry; the
            // whole-key views read the committed composite.
            if (latest?.type === 'tick') return `${latest.detail as number}`
            return `${detail.elapsed}`
          }}
        </evented.output>
      )
    }

    let result = render(<View />)
    t.after(() => result.cleanup())
    // The wildcard source reads the committed composite from the start.
    assert.equal(result.$('[aria-label="tick"]')?.textContent, '0')

    await result.act(async () => {
      await events.dispatchEvent({ tick: 0.5 })
      await settleEffects()
    })
    assert.equal(result.$('[aria-label="tick"]')?.textContent, '0.5')
    // The fold's own detail is the slice value the whole-key view reads last.
    assert.deepEqual(seen[seen.length - 1], [0.5, 'elapsed'])
  })

  it('folds null through the bare-name sugar for remembered events', async (t) => {
    class __KindEvents extends Events {
      kind = 'one-way'
    }
    let events = __KindEvents.define()
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

  it('keeps the live model current and treats undeclared machinery names as occurrences', async () => {
    class __SeedCountEvents extends Events {
      count = 0
    }
    let events = __SeedCountEvents.define()
    events.dispatchEvent({ count: 1 })
    assert.equal(events.detail.count, 1)
    events.dispatchEvent({ count: 2 })
    assert.equal(events.detail.count, 2)

    // The descriptor machinery names are just names: dispatching one that no
    // field declares is a transient occurrence, never a slice write.
    let events2 = __SeedCountEvents.define()
    await events2.dispatchEvent({ on: 1 } as any)
    assert.equal(events2.detail.count, 0)
  })

  it('exposes the wildcard source over the live composite', async (t) => {
    class __RootRefreshEvents extends Events {
      count = 0
      label = 'idle'
      inc(amount: number) {
        this.count += amount
      }
    }
    let events = __RootRefreshEvents.define()
    let seen: Array<[unknown, unknown]> = []

    function View() {
      return () => (
        <evented.output on={events.on['*']} aria-label="root">
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
    assert.deepEqual({ ...(seen[seen.length - 1]![0] as object) }, { count: 0, label: 'idle' })
    assert.equal(seen[seen.length - 1]![1], 'refresh')

    await result.act(async () => {
      await events.dispatchEvent({ inc: 2 })
      await settleEffects()
    })
    assert.equal(result.$('[aria-label="root"]')?.textContent, 'idle:2')
    assert.deepEqual({ ...(seen[seen.length - 1]![0] as object) }, { count: 2, label: 'idle' })
    assert.equal(seen[seen.length - 1]![1], 'count')
  })

  it('derives sibling values through folds', async (t) => {
    class __TemperatureEvents extends Events {
      celsius = ''
      fahrenheit = ''
      constructor(api: EventsApi<__TemperatureEvents>) {
    super()
        // Dispatching either unit writes its slice and derives the other.
        api.on.celsius(function ({ detail }) {
          let number = Number(detail)
          if (Number.isFinite(number) && detail.trim() !== '') {
            this.fahrenheit = String(number * (9 / 5) + 32)
          }
        })
        api.on.fahrenheit(function ({ detail }) {
          let number = Number(detail)
          if (Number.isFinite(number) && detail.trim() !== '') {
            this.celsius = String((number - 32) * (5 / 9))
          }
        })
      }
    }
    let events = __TemperatureEvents.define()

    function View() {
      return () => (
        <evented.output on={events.on['*']} aria-label="root">
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
    // The celsius fold ran and derived fahrenheit.
    assert.equal(result.$('[aria-label="root"]')?.textContent, '25/77')

    await result.act(async () => {
      await events.dispatchEvent({ fahrenheit: '212' })
      await settleEffects()
    })
    // The fahrenheit fold derived celsius; its own write stands.
    assert.equal(result.$('[aria-label="root"]')?.textContent, '100/212')
  })

  it('declares occurrences as empty recipes', async (t) => {
    class __DraftEvents extends Events {
      count = 0
      drafted(detail: string) {}
    }
    let events = __DraftEvents.define()
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
          <evented.output on={events.on['*']} aria-label="root">
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

  it('declares detail-less occurrences as zero-parameter recipes', async (t) => {
    class __BookingEvents extends Events {
      count = 0
      bookingConfirmed() {}
    }
    let events = __BookingEvents.define()
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
          <evented.output on={events.on['*']} aria-label="root">
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

  it('declares an occurrence vocabulary without a composite', async (t) => {
    class __VocabularyEvents extends Events {
      drafted(detail: string) {}
      refresh() {}
    }
    let events = __VocabularyEvents.define()

    function View() {
      return () => (
        <section>
          <evented.output on={events.on.drafted} aria-label="draft">
            {(draft) => draft ?? ''}
          </evented.output>
          <evented.div on={events.on['*']} aria-label="wild">
            {(_, event) => event?.type ?? 'none'}
          </evented.div>
        </section>
      )
    }

    let result = render(<View />)
    t.after(() => result.cleanup())
    assert.equal(result.$('[aria-label="wild"]')?.textContent, 'none')

    // The fires field typed the occurrence's detail.
    await result.act(async () => {
      await events.dispatchEvent({ drafted: 'hello' })
      await settleEffects()
    })
    assert.equal(result.$('[aria-label="draft"]')?.textContent, 'hello')
    assert.equal(result.$('[aria-label="wild"]')?.textContent, 'drafted')

    // A detail-less fires field declares a detail-less occurrence.
    await result.act(async () => {
      await events.dispatchEvent('refresh')
      await settleEffects()
    })
    assert.equal(result.$('[aria-label="wild"]')?.textContent, 'refresh')
  })

  it('delivers the owning element as the currentTarget of view callbacks', async (t) => {
    class __CountOneEvents extends Events {
      count = 0
    }
    let events = __CountOneEvents.define()

    let current: unknown
    function View() {
      return () => (
        <evented.output on={events.on['*']} aria-label="root">
          {(detail, event) => {
            current = event?.currentTarget
            return `${detail.count}`
          }}
        </evented.output>
      )
    }

    let result = render(<View />)
    t.after(() => result.cleanup())

    await result.act(async () => {
      await events.dispatchEvent({ count: 1 })
      await settleEffects()
    })
    assert.equal(result.$('[aria-label="root"]'), current)

    if (false) {
      // The matched event's currentTarget is the element type, not EventTarget.
      ;<evented.button on={events.on.count}>
        {(_, event) => {
          event?.currentTarget?.focus()
          return null
        }}
      </evented.button>
    }
  })

  it('renders children against the freshly patched props of the same update', async (t) => {
    class __CountTwoEvents extends Events {
      count = 0
    }
    let events = __CountTwoEvents.define()
    let current: unknown
    function View() {
      return () => (
        <evented.button
          on={events.on.count}
          data-count={(count) => `count-${count}`}
          aria-label="button"
        >
          {(_, event) => event?.currentTarget?.dataset.count ?? 'none'}
        </evented.button>
      )
    }

    let result = render(<View />)
    t.after(() => result.cleanup())
    assert.equal(result.$('[aria-label="button"]')?.textContent, 'none')

    // The children callback runs after the reactive props were patched to
    // the DOM, so the element's dataset reflects the same update's value.
    await result.act(async () => {
      await events.dispatchEvent({ count: 1 })
      await settleEffects()
    })
    assert.equal(result.$('[aria-label="button"]')?.textContent, 'count-1')

    await result.act(async () => {
      await events.dispatchEvent({ count: 2 })
      await settleEffects()
    })
    assert.equal(result.$('[aria-label="button"]')?.textContent, 'count-2')
  })

  it('emits slice events from fold draft writes, coalesced per flush', async () => {
    let heard: string[] = []
    class __IncrementEvents extends Events {
      count = 0
      label = 'idle'
      increment(by: number) {
        this.count += by
        this.label = `count is ${this.count}`
        this.count += 1
      }
      drafted(detail: string) {}
    }
    let events = __IncrementEvents.define()
    events.addEventListener('count', () => heard.push('count'))
    events.addEventListener('label', () => heard.push('label'))
    events.addEventListener('drafted', () => heard.push('drafted'))

    await events.dispatchEvent({ increment: 5 })
    // The fold's own event first, then one coalesced event per touched slice.
    assert.deepEqual(heard, ['count', 'label'])

    heard = []
    await events.dispatchEvent({ drafted: 'hello' })
    assert.deepEqual(heard, ['drafted'])
  })

  it('updates views progressively from async fold handlers', async (t) => {
    class __LoadEvents extends Events {
      phase = 'idle'
      value = 0
      async load(url: string) {
        this.phase = 'loading'
        // A macrotask boundary lets the session's flush run first, so the
        // loading state reaches views before the handler completes.
        await new Promise((resolve) => setTimeout(resolve, 0))
        this.phase = 'ready'
        this.value = Number(url)
      }
    }
    let events = __LoadEvents.define()
    function View() {
      return () => (
        <evented.output on={events.on['*']} aria-label="phase">
          {(detail) => `${detail.phase}:${detail.value}`}
        </evented.output>
      )
    }

    let result = render(<View />)
    t.after(() => result.cleanup())
    assert.equal(result.$('[aria-label="phase"]')?.textContent, 'idle:0')

    // The await boundary flushed the loading mutation already, before the
    // handler completed.
    let completion = events.dispatchEvent({ load: '42' })
    await settleEffects()
    assert.equal(result.$('[aria-label="phase"]')?.textContent, 'loading:0')

    // The dispatch settles after the handler and its remaining flushes.
    await completion
    assert.equal(result.$('[aria-label="phase"]')?.textContent, 'ready:42')
  })

  it('queues dispatch during an active fold session until its flush', async (t) => {
    class __BumpEvents extends Events {
      count = 0
      label = 'idle'
      bump(amount: number) {
        this.count += amount
        this.mark('bumped')
      }
      mark(value: string) {
        this.label = value
      }
    }
    let events = __BumpEvents.define()
    function View() {
      return () => (
        <evented.output on={events.on['*']} aria-label="root">
          {(detail) => `${detail.count}:${detail.label}`}
        </evented.output>
      )
    }

    let result = render(<View />)
    t.after(() => result.cleanup())
    assert.equal(result.$('[aria-label="root"]')?.textContent, '0:idle')

    // The nested fold call dispatches its event, which was deferred past the
    // bump fold's flush, so both writes land against the committed state and
    // the dispatch settles after the nested event too.
    await result.act(async () => {
      await events.dispatchEvent({ bump: 1 })
      await settleEffects()
    })
    assert.equal(result.$('[aria-label="root"]')?.textContent, '1:bumped')
  })

  it('queues dispatch from async handlers until the session flushes', async (t) => {
    class __WorkEvents extends Events {
      count = 0
      log = ''
      async work(amount: number) {
        this.count += amount
        this.finish()
        await Promise.resolve()
      }
      finish() {
        this.log = 'done'
      }
    }
    let events = __WorkEvents.define()
    function View() {
      return () => (
        <evented.output on={events.on['*']} aria-label="root">
          {(detail) => `${detail.count}:${detail.log}`}
        </evented.output>
      )
    }

    let result = render(<View />)
    t.after(() => result.cleanup())

    await result.act(async () => {
      await events.dispatchEvent({ work: 2 })
      await settleEffects()
    })
    assert.equal(result.$('[aria-label="root"]')?.textContent, '2:done')
  })

  it('settles the dispatch with the async handler rejection', async () => {
    class __ErrorEvents extends Events {
      count = 0
      async fail(_detail: null) {
        this.count = 1
        await Promise.resolve()
        throw new Error('boom')
      }
    }
    let events = __ErrorEvents.define()
    let completion = events.dispatchEvent({ fail: null })
    // The first mutation flushed before the rejection; the dispatch still
    // rejects with the handler's error.
    await settleEffects()
    assert.equal(events.detail.count, 1)
    await assert.rejects(completion, /boom/)
  })

  it('writes slice events through the object grammar', async (t) => {
    class __DerivedEvents extends Events {
      count = 0
      label = 'idle'
      inc(amount: number) {
        this.count += amount
      }
      drafted(detail: string) {}
    }
    let events = __DerivedEvents.define()
    function View() {
      return () => (
        <section>
          <evented.output on={events.on['*']} aria-label="root">
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

    // The live instance is the composite: object inputs read it directly.
    await result.act(async () => {
      await events.dispatchEvent({ drafted: `count=${events.detail.count}` })
      await settleEffects()
    })
    assert.equal(result.$('[aria-label="draft"]')?.textContent, 'count=0')

    // Object entries are computed at the call site and fold in order; per-name
    // values are data.
    await result.act(async () => {
      await events.dispatchEvent({ count: events.detail.count + 1, inc: events.detail.count })
      await settleEffects()
    })
    assert.equal(result.$('[aria-label="root"]')?.textContent, 'idle:1')

    // Object entries replace exactly their own slices.
    await result.act(async () => {
      await events.dispatchEvent({
        count: events.detail.count * 10,
        label: 'derived',
      })
      await settleEffects()
    })
    assert.equal(result.$('[aria-label="root"]')?.textContent, 'derived:10')

    // A function value of an event name is a plain detail, not a callback.
    let details: unknown[] = []
    let functionDetail = () => 'fn'
    events.addEventListener('drafted', (event) =>
      details.push((event as CustomEvent<unknown>).detail),
    )
    events.dispatchEvent({ drafted: functionDetail as unknown as string })
    assert.equal(details[details.length - 1], functionDetail)

    // Object inputs dispatch fine on occurrence-only instances too.
    class __PingEvents extends Events {
      ping() {}
    }
    let pinged: unknown[] = []
    let pure = __PingEvents.define()
    pure.addEventListener('ping', (event) => pinged.push((event as CustomEvent<unknown>).detail))
    await pure.dispatchEvent({ ping: 1 } as never)
    assert.deepEqual(pinged, [1])
  })

  it('writes slices through batch dispatches and per-field transactions', async (t) => {
    class __SliceEvents extends Events {
      count = 0
      label = 'idle'
      inc(amount: number) {
        this.count += amount
      }
    }
    let events = __SliceEvents.define()
    function View() {
      return () => (
        <evented.output on={events.on['*']} aria-label="root">
          {(detail) => `${detail.label}:${detail.count}`}
        </evented.output>
      )
    }

    let result = render(<View />)
    t.after(() => result.cleanup())
    assert.equal(result.$('[aria-label="root"]')?.textContent, 'idle:0')

    await result.act(async () => {
      await events.dispatchEvent({ count: 5, label: 'ready' })
      await settleEffects()
    })
    assert.equal(result.$('[aria-label="root"]')?.textContent, 'ready:5')

    // Per-field writes replace exactly the dispatched slices: fields it
    // omits keep their committed values.
    await result.act(async () => {
      await events.dispatchEvent({ count: 7 })
      await settleEffects()
    })
    assert.equal(result.$('[aria-label="root"]')?.textContent, 'ready:7')

    // A later fold entry reads the committed writes.
    await result.act(async () => {
      await events.dispatchEvent({ count: 1, label: 'folded' })
      await events.dispatchEvent({ inc: 2 })
      await settleEffects()
    })
    assert.equal(result.$('[aria-label="root"]')?.textContent, 'folded:3')

    // The built event carries its entries as a transaction.
    await result.act(async () => {
      await events.dispatchEvent(events.create({ count: 9, label: 'built' }))
      await settleEffects()
    })
    assert.equal(result.$('[aria-label="root"]')?.textContent, 'built:9')
  })

  it('reads and routes deep number-keyed collections by canonical segment', async (t) => {
    class __NumberBoardEvents extends Events {
      boards = new Map([
        [
          1,
          {
            cards: new Map([
              [10, { label: 'ten' }],
              [20, { label: 'twenty' }],
            ]),
          },
        ],
      ])
      rename(id: number) {
        let card = this.boards.get(1)?.cards.get(id)
        if (card) card.label = `${card.label}!`
      }
    }
    let events = __NumberBoardEvents.define()
    let calls = { board: 0, ten: 0, twenty: 0 }

    function Board() {
      return () => (
        <section>
          <evented.output on={events.on.boards}>{() => String(++calls.board)}</evented.output>
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
