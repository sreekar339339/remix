import { clientEntry, on, ref } from 'remix/ui'
import { Events, evented, type EventsApi } from '../utils/customEvents/index.tsx'
import { buttonCss, inputCss, rowCss, taskCss } from './styles.ts'

class SevenGuisTimerEvents extends Events {
  elapsed = 0
  duration = 10

  constructor({on}: EventsApi<SevenGuisTimerEvents>) {
    super()
    on.duration(function ({ detail }) {
      this.elapsed = Math.min(this.elapsed, detail)
    })
  }

  tick(delta: number) {
    this.elapsed = Math.min(this.duration, this.elapsed + delta)
  }
}

export const SevenGuisTimer = clientEntry(import.meta.url, function SevenGuisTimer() {
  let events = SevenGuisTimerEvents.define()

  return () => (
    <section
      mix={[
        taskCss,
        ref((_, signal) => {
          let last = performance.now()
          let id = window.setInterval(() => {
            let now = performance.now()
            let delta = (now - last) / 1000
            last = now
            events.dispatchEvent({ tick: delta })
          }, 100)
          signal.addEventListener('abort', () => window.clearInterval(id), {
            once: true,
          })
        }),
      ]}
    >
      <h2>Timer</h2>
      <div>
        <evented.progress
          on={events.on['*']}
          value={(current) => Math.min(1, current.elapsed / current.duration)}
          max={1}
        />
        <evented.output on={events.on.elapsed}>
          {(elapsed) => `${elapsed.toFixed(1)}s elapsed`}
        </evented.output>
      </div>
      <label mix={rowCss}>
        Duration
        <input
          type="range"
          min={1}
          max={30}
          step={0.5}
          defaultValue={10}
          mix={[
            inputCss,
            on('input', ({ currentTarget }) => {
              events.dispatchEvent({ duration: currentTarget.valueAsNumber })
            }),
          ]}
        />
        <evented.span on={events.on.duration}>
          {(duration) => `${duration.toFixed(1)}s`}
        </evented.span>
      </label>
      <button
        type="button"
        mix={[
          buttonCss,
          on('click', () => {
            events.dispatchEvent({ elapsed: 0 })
          }),
        ]}
      >
        Reset
      </button>
    </section>
  )
})
