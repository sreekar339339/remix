import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { render } from 'remix/ui/test'
import { AsyncJobRunner, createJobRunnerEvents, jobRunnerSteps } from './jobRunner.tsx'

const tick = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms))

describe('AsyncJobRunner', () => {
  it('flushes queued state and nested events progressively from an async handler', async (t) => {
    let result = render(<AsyncJobRunner />)
    t.after(() => result.cleanup())

    await result.act(() => (result.$('[data-action="run"]') as HTMLButtonElement).click())

    // During the setup await: the queued phase and its nested log line already
    // reached the views, while the handler is still running.
    await tick(60)
    assert.equal(result.$('[data-phase="queued"]')?.textContent, 'phase: queued')
    assert.match(result.$('[data-log]')?.textContent ?? '', /queued 3 steps/)

    // Wait for every step flush and the trailing flush.
    await tick(600)
    assert.equal(result.$('[data-phase="done"]')?.textContent, 'phase: done')

    let log = result.$('[data-log]')?.textContent ?? ''
    assert.match(log, /queued 3 steps/)
    assert.match(log, /done with build \(33%\)/)
    assert.match(log, /done with test \(67%\)/)
    assert.match(log, /done with ship \(100%\)/)
    assert.match(log, /all 3 steps done/)
    // Log order follows the deferred nested dispatches' drain order.
    assert.ok(log.indexOf('queued 3 steps') < log.indexOf('done with build'))
    assert.ok(log.indexOf('done with build') < log.indexOf('all 3 steps done'))

    // Per-item sources re-rendered exactly the touched step's counter.
    for (let step of jobRunnerSteps) {
      assert.equal(result.$(`[data-count="${step}"]`)?.textContent, `${step}: 1`)
    }

    // The nested occurrence fired; the flushed log entry carried the final
    // flush's drain, arriving after the transient occurrence.
    assert.equal(result.$('[data-last-completed]')?.textContent, 'last completed: ship')
    assert.equal(result.$('[data-last-event]')?.textContent, 'last event: log')
  })

  it('keeps flushed mutations visible and rejects the dispatch when an async handler throws', async () => {
    let events = createJobRunnerEvents({
      phase: 'idle',
      progress: 0,
      currentStep: null,
      log: [],
      counts: new Map(),
    })

    let completion = events.dispatchEvent({ fail: 'boom' })
    await tick(200)
    // The phase and its nested log line were flushed before the rejection.
    assert.equal(events.detail.phase, 'failed')
    assert.deepEqual(events.detail.log, ['boom'])
    await assert.rejects(completion, /boom/)
  })

  it('derives a dispatch input from the live composite', async (t) => {
    let result = render(<AsyncJobRunner />)
    t.after(() => result.cleanup())

    // The Fail button's derived input embeds the phase at dispatch time.
    await result.act(() => (result.$('[data-action="run"]') as HTMLButtonElement).click())
    await tick(600)
    await result.act(() => (result.$('[data-action="fail"]') as HTMLButtonElement).click())
    await tick(200)
    assert.equal(result.$('[data-phase="failed"]')?.textContent, 'phase: failed')
    assert.match(result.$('[data-log]')?.textContent ?? '', /boom from done/)
  })

  it('resets in place and writes slices through batch dispatches', async (t) => {
    let result = render(<AsyncJobRunner />)
    t.after(() => result.cleanup())

    await result.act(() => (result.$('[data-action="run"]') as HTMLButtonElement).click())
    await tick(600)
    assert.equal(result.$('[data-phase="done"]')?.textContent, 'phase: done')

    await result.act(() => (result.$('[data-action="reset"]') as HTMLButtonElement).click())
    await result.act(tick)
    assert.equal(result.$('[data-phase="idle"]')?.textContent, 'phase: idle')
    assert.equal(result.$('[data-log]')?.textContent, '')
    // The reset fold cleared the counts in place, so the per-item counters
    // routed back to zero.
    for (let step of jobRunnerSteps) {
      assert.equal(result.$(`[data-count="${step}"]`)?.textContent, `${step}: 0`)
    }
  })
})