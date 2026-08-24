import { clientEntry, css, on } from 'remix/ui'
import { Events, evented, type EventsApi } from '../utils/customEvents/index.tsx'
import { inputCss, rowCss, taskCss } from './styles.ts'

type Location = {
  id: string
  label: string
}

const COUNTRIES: readonly Location[] = [
  { id: 'us', label: 'United States' },
  { id: 'de', label: 'Germany' },
]

const STATES: Record<string, Location[]> = {
  us: [
    { id: 'ca', label: 'California' },
    { id: 'ny', label: 'New York' },
  ],
  de: [
    { id: 'by', label: 'Bavaria' },
    { id: 'be', label: 'Berlin' },
  ],
}

const CITIES: Record<string, Location[]> = {
  ca: [
    { id: 'sf', label: 'San Francisco' },
    { id: 'la', label: 'Los Angeles' },
  ],
  ny: [
    { id: 'nyc', label: 'New York City' },
    { id: 'buf', label: 'Buffalo' },
  ],
  by: [
    { id: 'mun', label: 'Munich' },
    { id: 'nur', label: 'Nuremberg' },
  ],
  be: [
    { id: 'ber', label: 'Berlin' },
    { id: 'pot', label: 'Potsdam' },
  ],
}

function labelOf(options: readonly Location[], id: string | null) {
  return options.find((option) => option.id === id)?.label ?? '—'
}

class LocationCascadeEvents extends Events {
  country = ''
  states = [] as readonly Location[]
  state = null as string | null
  cities = [] as readonly Location[]
  city = null as string | null

  constructor(api: EventsApi<LocationCascadeEvents>) {
    super()
    // Reactions derive the next cascade level and reset the deeper
    // selection chain when a slice is written. city has no derivation, so
    // it stays a plain detail.
    api.on.country(function ({ detail }) {
      this.states = STATES[detail] ?? []
      this.state = null
      this.cities = []
      this.city = null
    })
    api.on.state(function ({ detail }) {
      this.cities = CITIES[detail ?? ''] ?? []
      this.city = null
    })
  }
}

export const LocationCascade = clientEntry(import.meta.url, function LocationCascade() {


  let events = LocationCascadeEvents.define()
  return () => (
    <section mix={taskCss}>
      <h2>Location Cascade</h2>
      <div mix={[rowCss, css({ alignItems: 'end', flexWrap: 'wrap' })]}>
        <label>
          Country{' '}
          <evented.select
            on={events.on.country}
            aria-label="Country"
            value={(country) => country}
            mix={[
              inputCss,
              on('change', ({ currentTarget }) => {
                events.dispatchEvent({ country: currentTarget.value })
              }),
            ]}
          >
            {() => (
              <>
                <option value="">Select a country…</option>
                {COUNTRIES.map((country) => (
                  <option value={country.id}>{country.label}</option>
                ))}
              </>
            )}
          </evented.select>
        </label>
        <label>
          State{' '}
          <evented.select
            on={[events.on.states, events.on.state]}
            aria-label="State"
            value={([, state]) => state ?? ''}
            disabled={([states]) => states.length === 0}
            mix={[
              inputCss,
              on('change', ({ currentTarget }) => {
                events.dispatchEvent({ state: currentTarget.value })
              }),
            ]}
          >
            {([states]) => (
              <>
                <option value="">Select a state…</option>
                {states.map((detail) => (
                  <option value={detail.id}>{detail.label}</option>
                ))}
              </>
            )}
          </evented.select>
        </label>
        <label>
          City{' '}
          <evented.select
            on={[events.on.cities, events.on.city]}
            aria-label="City"
            value={([, city]) => city ?? ''}
            disabled={([cities]) => cities.length === 0}
            mix={[
              inputCss,
              on('change', ({ currentTarget }) => {
                events.dispatchEvent({ city: currentTarget.value })
              }),
            ]}
          >
            {([cities]) => (
              <>
                <option value="">Select a city…</option>
                {cities.map((city) => (
                  <option value={city.id}>{city.label}</option>
                ))}
              </>
            )}
          </evented.select>
        </label>
      </div>
      <evented.output
        on={[events.on.country, events.on.state, events.on.city]}
        aria-label="Selection"
      >
        {([country, detail, city]) =>
          `${labelOf(COUNTRIES, country)} / ${labelOf(STATES[country] ?? [], detail)} / ${labelOf(CITIES[detail ?? ''] ?? [], city)}`
        }
      </evented.output>
    </section>
  )
})
