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
        data-count={(_, event) =>
          Number(event?.currentTarget?.dataset.count ?? '0') + incrementOffset
        }
        mix={[
          buttonCss,
          on('click', () => {
            events.dispatchEvent('increment')
          }),
        ]}
      >
        {(_, event) => event?.currentTarget?.dataset.count ?? '0'}
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
