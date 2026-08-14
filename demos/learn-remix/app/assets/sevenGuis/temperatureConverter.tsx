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
    let events = customEvents({
      root: {
        celsius: '',
        fahrenheit: '',
      },
    })

    return () => (
      <section mix={taskCss}>
        <h2>Temperature Converter</h2>
        <div mix={rowCss}>
          <evented.input
            eventSource={events.on.celsius}
            aria-label="Celsius"
            value={(temperature) => temperature}
            mix={[
              inputCss,
              on('input', ({ currentTarget }) => {
                let value = currentTarget.value
                let number = parseTemperature(value)
                if (number === undefined) return
                events.dispatchEvent({
                  celsius: value,
                  // The fahrenheit leg derives from the freshly written celsius slice.
                  fahrenheit: (root) =>
                    formatTemperature(parseTemperature(root.celsius as string)! * (9 / 5) + 32),
                })
              }),
            ]}
          />
          <span>Celsius =</span>
          <evented.input
            eventSource={events.on.fahrenheit}
            aria-label="Fahrenheit"
            value={(temperature) => temperature}
            mix={[
              inputCss,
              on('input', ({ currentTarget }) => {
                let value = currentTarget.value
                let number = parseTemperature(value)
                if (number === undefined) return
                events.dispatchEvent({
                  celsius: formatTemperature((number - 32) * (5 / 9)),
                  fahrenheit: value,
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
