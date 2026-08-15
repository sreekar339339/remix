import { clientEntry, on } from 'remix/ui'
import { customEvents, evented } from '../utils/customEvents/index.tsx'
import { buttonCss } from './styles.ts'

export const SevenGuisCounter = clientEntry(import.meta.url, function SevenGuisCounter() {
  let events = customEvents<'increment'>()
  let incrementOffset = 1
  return () => (
    <>
      <evented.button
        initial={events.create('increment')}
        on={events}
        data-count={(_, event) => {
          // Only delivered events carry the button as their currentTarget;
          // the initial event precedes any element, so no value is written.
          let button = event?.currentTarget
          if (!button) return undefined
          return Number(button.dataset.count ?? '0') + incrementOffset
        }}
        mix={[
          buttonCss,
          on('click', () => {
            events.dispatchEvent('increment')
          }),
        ]}
      >
        {(_, event) => <span>{event?.currentTarget?.dataset.count ?? '0'}</span>}
      </evented.button>
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
