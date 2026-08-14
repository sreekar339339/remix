import * as assert from 'remix/assert'
import { it } from 'remix/test'
import { customEvents } from './index.tsx'
import { createCustomEventsRuntimeState, customEventsRuntime } from './runtime.ts'

const subscriptionCount = 5_000
const dispatchCount = 500
const targetKey = String(subscriptionCount - 1)

it('benchmarks fold-recipe dispatch', async () => {
  let lastId = -1
  let events = customEvents({
    root: {
      items: new Map<number, { id: number; label: string }>(),
    },
    update: (detail: { id: number; label: string }, root) => {
      root.items.set(detail.id, detail)
      lastId = detail.id
    },
  })
  for (let index = 0; index < 1_000; index++) {
    await events.dispatchEvent({ update: { id: index, label: `item-${index}` } })
  }
  lastId = -1

  let started = performance.now()
  for (let index = 0; index < dispatchCount; index++) {
    await events.dispatchEvent({ update: { id: index, label: `item-${index}` } })
  }
  let duration = performance.now() - started

  console.log('[customEvents fold dispatch]', {
    dispatches: dispatchCount,
    durationMs: Number(duration.toFixed(2)),
    averageDispatchMs: Number((duration / dispatchCount).toFixed(4)),
  })
  assert.equal(lastId, dispatchCount - 1)
})

it('benchmarks no-subscriber dispatch', async () => {
  let runtime = createCustomEventsRuntimeState()
  let host = document.createElement('section')
  let origin = document.createElement('button')
  host.append(origin)
  let unregisterHost = customEventsRuntime.registerHost(runtime, host)
  let init = { bubbles: true, cancelable: false }

  let createEvent = () =>
    customEventsRuntime.createProductEvent(runtime, 'itemUpdated', null, init, [
      {
        type: 'itemUpdated',
        detail: null,
        addresses: [[targetKey]],
      },
    ])

  for (let index = 0; index < 20; index++) {
    await customEventsRuntime.dispatch(runtime, origin, createEvent())
  }

  let started = performance.now()
  for (let index = 0; index < dispatchCount; index++) {
    await customEventsRuntime.dispatch(runtime, origin, createEvent())
  }
  let duration = performance.now() - started

  console.log('[customEvents no-subscriber dispatch]', {
    dispatches: dispatchCount,
    durationMs: Number(duration.toFixed(2)),
    averageDispatchMs: Number((duration / dispatchCount).toFixed(4)),
  })

  unregisterHost()
})

it('benchmarks addressed subscription matching', async () => {
  let runtime = createCustomEventsRuntimeState()
  let host = document.createElement('section')
  let origin = document.createElement('button')
  host.append(origin)
  let unregisterHost = customEventsRuntime.registerHost(runtime, host)
  let cleanups: Array<() => void> = []
  let notifications = 0

  for (let index = 0; index < subscriptionCount; index++) {
    let element = document.createElement('output')
    host.append(element)
    cleanups.push(
      customEventsRuntime.subscribe(runtime, 'view', {
        element,
        eventTypes: new Set(['itemUpdated']),
        addresses: new Map([['itemUpdated', [String(index)]]]),
        notify() {
          notifications++
        },
      }),
    )
  }

  function createKeyedEvent() {
    let init = { bubbles: true, cancelable: false }
    return customEventsRuntime.createProductEvent(runtime, 'itemUpdated', null, init, [
      {
        type: 'itemUpdated',
        detail: null,
        addresses: [[String(targetKey)]],
      },
    ])
  }

  for (let index = 0; index < 20; index++) {
    await customEventsRuntime.dispatch(runtime, origin, createKeyedEvent())
  }
  notifications = 0

  let started = performance.now()
  for (let index = 0; index < dispatchCount; index++) {
    await customEventsRuntime.dispatch(runtime, origin, createKeyedEvent())
  }
  let duration = performance.now() - started

  console.log('[customEvents address matching]', {
    subscriptions: subscriptionCount,
    dispatches: dispatchCount,
    durationMs: Number(duration.toFixed(2)),
    averageDispatchMs: Number((duration / dispatchCount).toFixed(4)),
  })
  assert.equal(notifications, dispatchCount)

  for (let cleanup of cleanups) cleanup()
  unregisterHost()
})
