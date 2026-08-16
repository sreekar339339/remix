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
    let events = customEvents(
      {
        celsius: '',
        fahrenheit: '',
        // Each fold shadows its root detail: dispatching the name runs the
        // recipe instead of the implicit replace-itself fold, so editing either
        // unit converts the other.
      },
      {
        celsius: (value: string, detail) => {
          detail.celsius = value
          let number = parseTemperature(value)
          if (number !== undefined) {
            detail.fahrenheit = formatTemperature(number * (9 / 5) + 32)
          }
        },
        fahrenheit: (value: string, detail) => {
          detail.fahrenheit = value
          let number = parseTemperature(value)
          if (number !== undefined) {
            detail.celsius = formatTemperature((number - 32) * (5 / 9))
          }
        },
      },
    )
    return () => (
      <section mix={taskCss}>
        <h2>Temperature Converter</h2>
        <div mix={rowCss}>
          <evented.input
            on={events.on.celsius}
            aria-label="Celsius"
            value={(temperature) => temperature}
            mix={[
              inputCss,
              on('input', ({ currentTarget }) => {
                events.dispatchEvent({ celsius: currentTarget.value })
              }),
            ]}
          />
          <span>Celsius =</span>
          <evented.input
            on={events.on.fahrenheit}
            aria-label="Fahrenheit"
            value={(temperature) => temperature}
            mix={[
              inputCss,
              on('input', ({ currentTarget }) => {
                events.dispatchEvent({ fahrenheit: currentTarget.value })
              }),
            ]}
          />
          <span>Fahrenheit</span>
        </div>
      </section>
    )
  },
)
