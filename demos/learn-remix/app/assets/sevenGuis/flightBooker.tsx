import { clientEntry, on } from 'remix/ui'
import { customEvents } from '../utils/customEvents/index.tsx'
import { buttonCss, inputCss, rowCss, taskCss } from './styles.ts'

type FlightKind = 'one-way flight' | 'return flight'
type Flight = {
  kind: FlightKind
  startDate: string
  returnDate: string
}
type FlightEvents = Flight | 'bookingConfirmed'

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  let [year, month, day] = value.split('-').map(Number)
  let date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

function canBook({ kind, startDate, returnDate }: Flight) {
  if (!isValidDate(startDate)) return false
  return kind === 'one-way flight' || (isValidDate(returnDate) && returnDate >= startDate)
}

function presentValidation(flight: Flight) {
  return {
    startDateInvalid: !isValidDate(flight.startDate),
    returnDateDisabled: flight.kind === 'one-way flight',
    returnDateInvalid:
      flight.kind === 'return flight' &&
      (!isValidDate(flight.returnDate) || flight.returnDate < flight.startDate),
  }
}

export const SevenGuisFlightBooker = clientEntry(
  import.meta.url,
  function SevenGuisFlightBooker(handle) {
    let today = new Date().toISOString().slice(0, 10)
    let { view, events, state, host } = customEvents<FlightEvents>().store({
      kind: 'one-way flight',
      startDate: today,
      returnDate: today,
    })
    let confirmedFlight: Flight | null = null
    return () => (
      <section
        mix={[
          taskCss,
          events.on((event) => {
            if (event.type !== 'bookingConfirmed') return handle.update()
          }),
        ]}
      >
        <h2>Flight Booker</h2>
        <select
          aria-label="Flight type"
          defaultValue={state.value.kind}
          mix={[
            inputCss,
            on('change', ({ currentTarget }) => {
              state.update((draft) => {
                draft.kind = currentTarget.value as FlightKind
              })
            }),
          ]}
        >
          <option>one-way flight</option>
          <option>return flight</option>
        </select>
        <div mix={rowCss}>
          <input
            aria-label="Start date"
            defaultValue={state.value.startDate}
            aria-invalid={presentValidation(state.value).startDateInvalid}
            mix={[
              inputCss,
              on('input', ({ currentTarget }) => {
                state.update((draft) => {
                  draft.startDate = currentTarget.value
                })
              }),
            ]}
          />
          <input
            aria-label="Return date"
            defaultValue={state.value.returnDate}
            disabled={presentValidation(state.value).returnDateDisabled}
            aria-invalid={presentValidation(state.value).returnDateInvalid}
            mix={[
              inputCss,
              on('input', ({ currentTarget }) => {
                state.update((draft) => {
                  draft.returnDate = currentTarget.value
                })
              }),
            ]}
          />
        </div>
        <button
          type="button"
          disabled={!canBook(state.value)}
          mix={[
            buttonCss,
            on('click', () => {
              confirmedFlight = {
                kind: state.value.kind,
                startDate: state.value.startDate,
                returnDate: state.value.returnDate,
              }
              host.dispatchEvent(events.create('bookingConfirmed'))
            }),
          ]}
        >
          Book
        </button>
        <view.output on={events.bookingConfirmed} hidden={({ detail }) => detail === undefined}>
          {({ detail }) => {
            if (detail === undefined || !confirmedFlight) return null
            return confirmedFlight.kind === 'one-way flight'
              ? `You have booked a one-way flight on ${confirmedFlight.startDate}.`
              : `You have booked a return flight from ${confirmedFlight.startDate} to ${confirmedFlight.returnDate}.`
          }}
        </view.output>
      </section>
    )
  },
)
