import { clientEntry, on } from 'remix/ui'
import { customEvents, evented } from '../utils/customEvents/index.tsx'
import { inputCss, rowCss, taskCss } from './styles.ts'

function parseTemperature(value: string) {
  let number = Number(value)
  return Number.isFinite(number) && value.trim() !== '' ? number : undefined
}

function formatTemperature(value: number) {
  return Number(value.toFixed(2)).toString()
}

export const SevenGuisTemperatureConverter = clientEntry(
  import.meta.url,
  function SevenGuisTemperatureConverter() {
    let { events, state } = customEvents().store({
      celsius: '',
      fahrenheit: '',
    })

    return () => (
      <section mix={taskCss}>
        <h2>Temperature Converter</h2>
        <div mix={rowCss}>
          <evented.input
            eventSource={events.celsius}
            aria-label="Celsius"
            value={(detail) => detail}
            mix={[
              inputCss,
              on('input', ({ currentTarget }) => {
                let value = currentTarget.value
                let number = parseTemperature(value)
                if (number === undefined) return
                state.update((draft) => {
                  draft.celsius = value
                  draft.fahrenheit = formatTemperature(number * (9 / 5) + 32)
                })
              }),
            ]}
          />
          <span>Celsius =</span>
          <evented.input
            eventSource={events.fahrenheit}
            aria-label="Fahrenheit"
            value={(detail) => detail}
            mix={[
              inputCss,
              on('input', ({ currentTarget }) => {
                let value = currentTarget.value
                let number = parseTemperature(value)
                if (number === undefined) return
                state.update((draft) => {
                  draft.celsius = formatTemperature((number - 32) * (5 / 9))
                  draft.fahrenheit = value
                })
              }),
            ]}
          />
          <span>Fahrenheit</span>
        </div>
      </section>
    )
  },
)
