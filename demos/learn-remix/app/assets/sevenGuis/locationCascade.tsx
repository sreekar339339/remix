import { clientEntry, css, on } from 'remix/ui'
import { customEvents, evented } from '../utils/customEvents/index.tsx'
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

export const LocationCascade = clientEntry(import.meta.url, function LocationCascade() {
  let events = customEvents({
    root: {
      country: '',
      states: [] as readonly Location[],
      state: null as string | null,
      cities: [] as readonly Location[],
      city: null as string | null,
    },

    // Each fold shadows its slice: selecting a country owns the country
    // detail and derives the next level — the state options — resetting the
    // deeper selection chain.
    country: (id: string, root) => {
      root.country = id
      root.states = STATES[id] ?? []
      root.state = null
      root.cities = []
      root.city = null
    },
    state: (id: string, root) => {
      root.state = id
      root.cities = CITIES[id] ?? []
      root.city = null
    },
    // city has no derivation, so it stays a plain detail: dispatching city
    // replaces its slice directly.
  })

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
                {states.map((state) => (
                  <option value={state.id}>{state.label}</option>
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
        {([country, state, city]) =>
          `${labelOf(COUNTRIES, country)} / ${labelOf(STATES[country] ?? [], state)} / ${labelOf(CITIES[state ?? ''] ?? [], city)}`
        }
      </evented.output>
    </section>
  )
})
