import { clientEntry, on } from 'remix/ui'
import { Events, evented, type EventsApi } from '../utils/customEvents/index.tsx'
import { inputCss, rowCss, taskCss } from './styles.ts'

function parseTemperature(value: string) {
  let number = Number(value)
  return Number.isFinite(number) && value.trim() !== '' ? number : undefined
}

function formatTemperature(value: number) {
  return Number(value.toFixed(2)).toString()
}

class TemperatureConverterEvents extends Events {
  celsius = ''
  fahrenheit = ''
  constructor({on}: EventsApi<TemperatureConverterEvents>) {
    super()
    // Dispatching either unit writes its slice and runs the reaction, so
    // editing one converts the other.
    on.celsius(function ({ detail }) {
      let number = parseTemperature(detail)
      if (number !== undefined) {
        this.fahrenheit = formatTemperature(number * (9 / 5) + 32)
      }
    })
    on.fahrenheit(function ({ detail }) {
      let number = parseTemperature(detail)
      if (number !== undefined) {
        this.celsius = formatTemperature((number - 32) * (5 / 9))
      }
    })
  }
}

export const SevenGuisTemperatureConverter = clientEntry(
  import.meta.url,
  function SevenGuisTemperatureConverter() {

    let events = TemperatureConverterEvents.define()

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
