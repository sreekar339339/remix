import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { on, ref } from 'remix/ui'
import { render } from 'remix/ui/test'
import { Events, evented } from './index.tsx'
import { createCustomEventsRuntimeState, customEventsRuntime } from './runtime.ts'
import { createEvents, settleEffects } from './customEvents.test-utils.tsx'

describe('customEvents', () => {
  it('supports event names that collide with Function properties', async (t) => {
    class __CollidingEvents extends Events {
      name() {}
      length() {}
      bind() {}
      toString() {}
    }
    let events = __CollidingEvents.define()

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
            on={events.on['*']}
            aria-label="form"
            class={(detail, event) => (event?.type === 'submitted' ? 'pending' : '')}
            aria-busy={(detail, event) => event?.type === 'submitted'}
            mix={events.on.submitted(({ currentTarget }) => {
              currentTarget.dataset.committed = String(currentTarget.classList.contains('pending'))
            })}
          >
            {(detail, event) => (
              <output>{event?.type === 'submitted' ? (event.detail as { id: string }).id : 'idle'}</output>
            )}
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

  it('renders occurrences after a matching event first arrives', async (t) => {
    let events = createEvents()

    function Confirmation() {
      return () => (
        <section mix={events.asHost()} aria-label="confirmation-host">
          <evented.output
            on={events.on['*']}
            hidden={(detail, event) => event?.type !== 'submitted'}
            aria-label="confirmation"
          >
            {(detail, event) =>
              event?.type === 'submitted' ? (event.detail as { id: string }).id ?? null : null
            }
          </evented.output>
          <evented.output
            on={events.on['*']}
            hidden={(detail, event) =>
              event?.type === 'submitted' && (event.detail as { id: string }).id === 'hidden'
            }
            aria-label="initial-confirmation"
          >
            {(detail, event) =>
              event?.type === 'submitted' ? (event.detail as { id: string }).id : 'initial'
            }
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
          on={events.on['*']}
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
            on={events.on['*']}
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
              on={events.on['*']}
              aria-label={id}
              mix={events.on['*'](({ currentTarget, type }) => {
                currentTarget.dataset.effect = type
              })}
            >
              {(detail, event) =>
                event && event.type === 'submitted'
                  ? (event.detail as { id: string }).id ?? ''
                  : 'idle'
              }
            </evented.output>
          ))}
          <evented.output on={events.on['*']} aria-label="all">
            {(value, event) =>
              event ? (event.type === 'paid' ? 'idle' : event.type) : ''
            }
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
            on={events.on['*']}
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
    domain.dispatchEvent(events.create({ paid: 1 } as never))
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
