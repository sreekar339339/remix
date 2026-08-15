import { clientEntry, on } from 'remix/ui'
import { customEvents, evented } from './utils/customEvents/index.tsx'

export const Counter = clientEntry(import.meta.url, function Counter(handle) {
  let incrementOffset = 1
  let events = customEvents({
    root: {
      count: 0,
    },
    increment: (_detail, root) => {
      root.count += incrementOffset
    },
  })
  return () => (
    <>
      <button
        mix={[
          on('click', () => {
            events.dispatchEvent('increment')
          }),
        ]}
      >
        <evented.span on={events}>{(current) => current.count}</evented.span>
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
