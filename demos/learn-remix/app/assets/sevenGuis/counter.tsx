import { clientEntry, on } from 'remix/ui'
import { Events, evented as e } from '../utils/customEvents/index.tsx'
import { buttonCss } from './styles.ts'

class SevenGuisCounterEvents extends Events {
  count = 0
  increment(by: number) {
    this.count += by
  }
}

export const SevenGuisCounter = clientEntry(import.meta.url, function SevenGuisCounter() {
  let events = SevenGuisCounterEvents.define()
  let incrementOffset = 1
  return () => (
    <>
      <e.button
        on={events.on.count}
        data-count={(count) => String(count)}
        mix={[
          buttonCss,
          on('click', () => {
            events.dispatchEvent({ increment: incrementOffset })
          }),
        ]}
      >
        {(count) => count}
      </e.button>
      <label>
        Increment by{' '}
        <input
          mix={on('input', ({ currentTarget }) => {
            incrementOffset = currentTarget.valueAsNumber
          })}
          type="number"
          defaultValue={incrementOffset}
        />
      </label>
    </>
  )
})
