import { clientEntry, on } from 'remix/ui'
import { customEvents, evented } from '../utils/customEvents/index.tsx'
import { buttonCss } from './styles.ts'

export const SevenGuisCounter = clientEntry(import.meta.url, function SevenGuisCounter() {
  let events = customEvents({
    root: {
      count: 0,
    },
  })
  let incrementOffset = 1
  return () => (
    <>
      <button
        mix={[
          buttonCss,
          on('click', () => {
            events.dispatchEvent(({ count }) => ({ count: count + incrementOffset }))
          }),
        ]}
      >
        <evented.span on={events.on.count}>{(count) => count}</evented.span>
      </button>
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
