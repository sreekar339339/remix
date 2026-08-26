import { clientEntry, css, on } from 'remix/ui'
import { Events, evented as e, type EventsApi } from './utils/customEvents/index.tsx'

export const jobRunnerSteps = ['build', 'test', 'ship'] as const

export type JobRunnerState = {
  phase: 'idle' | 'queued' | 'running' | 'done' | 'failed'
  progress: number
  currentStep: string | null
  log: string[]
  counts: Map<string, number>
}

const setupDelayMs = 120
const stepDelayMs = 30
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export type JobRunnerHandlers = {
  run: (steps: string[]) => Promise<void>
  fail: (message: string) => Promise<void>
  logEntry: (entry: string) => void
  reset: () => void
  stepCompleted: (step: string) => void
  jobCompleted: () => void
}

/**
 * The job runner's events. The `run` recipe is the centerpiece: an async
 * handler that calls other events while its session is open. Nested
 * dispatches run while the session has uncommitted mutations they are
 * deferred until the next flush, so they always read and write the committed
 * composite — never the in-flight draft — and the dispatch settles only after
 * the nested events too.
 */
export class JobRunnerEvents extends Events {
  phase: JobRunnerState['phase']
  progress: number
  currentStep: string | null
  log: string[]
  counts: Map<string, number>

  constructor(api: EventsApi<JobRunnerEvents>, seed: JobRunnerState) {
    super()
    this.phase = seed.phase
    this.progress = seed.progress
    this.currentStep = seed.currentStep
    this.log = seed.log
    this.counts = seed.counts
  }

  async run(steps: string[]) {
    this.phase = 'queued'
    // A nested dispatch during the session: deferred until the next flush,
    // so the log fold reads the committed composite.
    this.logEntry(`queued ${steps.length} steps`)
    // The await boundary is the async work; the session flushes here, so
    // views already show the queued phase and its log line.
    await delay(setupDelayMs)

    for (let index = 0; index < steps.length; index++) {
      let step = steps[index]
      let pct = Math.round(((index + 1) / steps.length) * 100)
      this.phase = 'running'
      this.currentStep = step
      this.progress = pct
      this.counts.set(step, (this.counts.get(step) ?? 0) + 1)
      // Two more nested calls: a declared occurrence and a log fold.
      this.stepCompleted(step)
      this.logEntry(`done with ${step} (${pct}%)`)
      await delay(stepDelayMs)
    }

    this.phase = 'done'
    this.progress = 100
    this.currentStep = null
    this.logEntry(`all ${steps.length} steps done`)
    // A bare-name dispatch: any name works as a transient occurrence.
    this.jobCompleted()
    await delay(stepDelayMs)
  }

  async fail(message: string) {
    this.phase = 'failed'
    this.logEntry(message)
    await delay(setupDelayMs)
    // The flush committed the failed phase and its log line; the rejection
    // propagates through the dispatch so callers can react to it.
    throw new Error(message)
  }

  logEntry(entry: string) {
    this.log = [...this.log, entry]
  }

  reset() {
    this.phase = 'idle'
    this.progress = 0
    this.currentStep = null
    this.log = []
    this.counts.clear()
  }

  stepCompleted(detail: string) {}
  jobCompleted() {}
}

export const createJobRunnerEvents = (seed: JobRunnerState) =>
  JobRunnerEvents.define(seed)

export const AsyncJobRunner = clientEntry(import.meta.url, function AsyncJobRunner() {
  let seed: JobRunnerState = {
    phase: 'idle',
    progress: 0,
    currentStep: null,
    log: [],
    counts: new Map(),
  }
  let events = createJobRunnerEvents(seed)

  return () => (
    <section mix={css({ display: 'grid', gap: 12, maxWidth: 420 })}>
      <h2>Async job runner</h2>
      <p>
        `run` is an async handler that dispatches other events mid-flight; each `await` flushes the
        session so views update progressively, and nested events are deferred until the flush.
      </p>
      <e.div
        on={[events.on.phase, events.on.progress, events.on.currentStep, events.on.log]}
        mix={css({ display: 'grid', gap: 8 })}
      >
        {([phase, progress, currentStep, log]) => (
          <>
            <p data-phase={phase}>phase: {phase}</p>
            <progress value={progress} max={100} />
            <p>current step: {currentStep ?? '—'}</p>
            <div mix={css({ display: 'flex', gap: 12 })}>
              {jobRunnerSteps.map((step) => (
                <e.output key={step} on={events.on.counts.get(step)} data-count={step}>
                  {(count) => `${step}: ${count ?? 0}`}
                </e.output>
              ))}
            </div>
            <ul data-log mix={css({ paddingInlineStart: 20, margin: 0 })}>
              {log.map((entry, index) => (
                <li key={index}>{entry}</li>
              ))}
            </ul>
          </>
        )}
      </e.div>
      <div mix={css({ display: 'flex', gap: 8 })}>
        <span
          data-last-completed
          mix={events.on.stepCompleted(({ detail, currentTarget }) => {
            currentTarget.textContent = `last completed: ${detail}`
          })}
        />
        <span
          data-last-event
          mix={events.on['*'](({ type, currentTarget }) => {
            currentTarget.textContent = `last event: ${type}`
          })}
        />
      </div>
      <div mix={css({ display: 'flex', gap: 8 })}>
        <button
          type="button"
          data-action="run"
          mix={on('click', () => {
            events.dispatchEvent({ run: [...jobRunnerSteps] })
          })}
        >
          Run
        </button>
        <button
          type="button"
          data-action="fail"
          mix={on('click', () => {
            void events
              .dispatchEvent({ fail: `boom from ${events.details.phase}` })
              .catch(() => {})
          })}
        >
          Fail
        </button>
        <button
          type="button"
          data-action="reset"
          mix={on('click', () => {
            events.dispatchEvent('reset')
          })}
        >
          Reset
        </button>
      </div>
    </section>
  )
})
