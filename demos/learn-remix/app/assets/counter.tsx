import { clientEntry, on } from 'remix/ui'
import { customEvents, evented } from './utils/customEvents/index.tsx'

export const Counter = clientEntry(import.meta.url, function Counter(handle) {
  let { events, state } = customEvents().store({
    count: 0,
  })
  let incrementOffset = 1
  return () => (
    <>
      <button
        mix={[
          on('click', () => {
            state.update((draft) => {
              draft.count += incrementOffset
            })
          }),
        ]}
      >
        <evented.span eventSource={events}>{(detail) => detail.count}</evented.span>
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
