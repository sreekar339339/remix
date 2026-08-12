import { clientEntry, on } from 'remix/ui'
import { customEvents, evented } from '../utils/customEvents/index.tsx'
import { buttonCss, inputCss, rowCss, taskCss } from './styles.ts'

type FlightKind = 'one-way flight' | 'return flight'
type Flight = {
  kind: FlightKind
  startDate: string
  returnDate: string
}

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
    let events = customEvents({
      kind: 'one-way flight' as FlightKind,
      startDate: today,
      returnDate: today,
    })
    let confirmedFlight: Flight | null = null
    return () => (
      <evented.section eventSource={events} mix={[taskCss]}>
        {(flight) => (
          <>
            <h2>Flight Booker</h2>
            <select
              aria-label="Flight type"
              defaultValue={flight.kind}
              mix={[
                inputCss,
                on('change', ({ currentTarget }) => {
                  events.dispatchEvent({ kind: currentTarget.value as FlightKind })
                }),
              ]}
            >
              <option>one-way flight</option>
              <option>return flight</option>
            </select>
            <div mix={rowCss}>
              <input
                aria-label="Start date"
                defaultValue={flight.startDate}
                aria-invalid={presentValidation(flight).startDateInvalid}
                mix={[
                  inputCss,
                  on('input', ({ currentTarget }) => {
                    events.dispatchEvent({ startDate: currentTarget.value })
                  }),
                ]}
              />
              <input
                aria-label="Return date"
                defaultValue={flight.returnDate}
                disabled={presentValidation(flight).returnDateDisabled}
                aria-invalid={presentValidation(flight).returnDateInvalid}
                mix={[
                  inputCss,
                  on('input', ({ currentTarget }) => {
                    events.dispatchEvent({ returnDate: currentTarget.value })
                  }),
                ]}
              />
            </div>
            <button
              type="button"
              disabled={!canBook(flight)}
              mix={[
                buttonCss,
                on('click', () => {
                  confirmedFlight = {
                    kind: flight.kind,
                    startDate: flight.startDate,
                    returnDate: flight.returnDate,
                  }
                  events.dispatchEvent('bookingConfirmed')
                }),
              ]}
            >
              Book
            </button>
            <output hidden={confirmedFlight === null}>
              {confirmedFlight?.kind === 'one-way flight'
                ? `You have booked a one-way flight on ${confirmedFlight.startDate}.`
                : confirmedFlight
                  ? `You have booked a return flight from ${confirmedFlight.startDate} to ${confirmedFlight.returnDate}.`
                  : null}
            </output>
          </>
        )}
      </evented.section>
    )
  },
)
