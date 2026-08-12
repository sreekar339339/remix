import { clientEntry, on, ref } from 'remix/ui'
import { customEvents, evented } from '../utils/customEvents/index.tsx'
import { buttonCss, inputCss, rowCss, taskCss } from './styles.ts'

export const SevenGuisTimer = clientEntry(import.meta.url, function SevenGuisTimer() {
  let events = customEvents(
    { elapsed: 0, duration: 10 },
    {
      tick: (draft, delta: number) => {
        draft.elapsed = Math.min(draft.duration, draft.elapsed + delta)
      },
      setDuration: (draft, duration: number) => {
        draft.duration = duration
        draft.elapsed = Math.min(draft.elapsed, duration)
      },
    },
  )
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
          eventSource={events}
          value={(current) => Math.min(1, current.elapsed / current.duration)}
          max={1}
        />
        <evented.output eventSource={events.elapsed}>
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
              events.dispatchEvent({ setDuration: currentTarget.valueAsNumber })
            }),
          ]}
        />
        <evented.span eventSource={events.duration}>
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
