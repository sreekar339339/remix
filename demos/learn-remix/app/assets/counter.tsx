import { clientEntry, on } from 'remix/ui'
import { customEvents, evented } from './utils/customEvents/index.tsx'

export const Counter = clientEntry(import.meta.url, function Counter(handle) {
  let events = customEvents(
    { count: 0 },
    {
      increment: (draft) => {
        draft.count += incrementOffset
      },
    },
  )
  let incrementOffset = 1
  return () => (
    <>
      <button
        mix={[
          on('click', () => {
            events.dispatchEvent('increment')
          }),
        ]}
      >
        <evented.span eventSource={events}>{(current) => current.count}</evented.span>
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
