import { clientEntry, css, on } from 'remix/ui'
import { customEvents } from '../utils/customEvents/index.tsx'
import { buttonCss, inputCss, rowCss, taskCss } from './styles.ts'

type Person = {
  id: number
  name: string
  surname: string
}

type CrudModel = {
  people: Array<Person>
  prefix: string
  selectedId: number | null
  draft: { name: string; surname: string }
  nextId: number
}

function visiblePeople(people: readonly Person[], prefix: string) {
  return people.filter((person) => person.surname.toLowerCase().startsWith(prefix.toLowerCase()))
}

export const SevenGuisCrud = clientEntry(import.meta.url, function SevenGuisCrud() {
  let { events, state } = customEvents<CrudModel>().store({
    people: [
      { id: 1, name: 'Hans', surname: 'Emil' },
      { id: 2, name: 'Max', surname: 'Mustermann' },
      { id: 3, name: 'Roman', surname: 'Tisch' },
    ],
    prefix: '',
    selectedId: null,
    draft: { name: '', surname: '' },
    nextId: 4,
  })
  return () => (
    <section mix={taskCss}>
      <h2>CRUD</h2>
      <label>
        Filter prefix{' '}
        <input
          aria-label="Filter prefix"
          defaultValue={state.value.prefix}
          mix={[
            inputCss,
            on('input', ({ currentTarget }) => {
              state.update((draft) => {
                draft.prefix = currentTarget.value
              })
            }),
          ]}
        />
      </label>
      <div
        mix={[
          rowCss,
          css({
            display: 'grid',
            gridTemplateColumns: 'minmax(180px, 1fr) auto',
            alignItems: 'start',
          }),
        ]}
      >
        <select
          eventSource={[events.people, events.prefix, events.selectedId]}
          size={7}
          aria-label="People"
          value={(values) => (values as [unknown, unknown, number | null])[2] ?? ''}
          mix={[
            inputCss,
            on('change', ({ currentTarget }) => {
              state.update((draft) => {
                let selected = draft.people.find(
                  (person) => person.id === Number(currentTarget.value),
                )
                if (!selected) return
                draft.selectedId = selected.id
                draft.draft.name = selected.name
                draft.draft.surname = selected.surname
              })
            }),
          ]}
        >
          {(values) => {
            let [people, prefix] = values as [readonly Person[], string]
            return visiblePeople(people, prefix).map((person) => (
              <option value={person.id}>
                {person.surname}, {person.name}
              </option>
            ))
          }}
        </select>
        <div eventSource={[events.draft, events.selectedId]} mix={css({ display: 'grid', gap: 8 })}>
          {(values) => {
            let [draft, selectedId] = values as [CrudModel['draft'], number | null]
            return (
              <>
                <label>
                  Name{' '}
                  <input
                    aria-label="Name"
                    value={draft.name}
                    mix={[
                      inputCss,
                      on('input', ({ currentTarget }) => {
                        state.update((draft) => {
                          draft.draft.name = currentTarget.value
                        })
                      }),
                    ]}
                  />
                </label>
                <label>
                  Surname{' '}
                  <input
                    aria-label="Surname"
                    value={draft.surname}
                    mix={[
                      inputCss,
                      on('input', ({ currentTarget }) => {
                        state.update((draft) => {
                          draft.draft.surname = currentTarget.value
                        })
                      }),
                    ]}
                  />
                </label>
                <div mix={rowCss}>
                  <button
                    type="button"
                    disabled={!(draft.name.trim() && draft.surname.trim())}
                    mix={[
                      buttonCss,
                      on('click', () => {
                        state.update((draft) => {
                          let person = {
                            id: draft.nextId++,
                            ...draft.draft,
                          }
                          draft.people.push(person)
                          draft.selectedId = person.id
                        })
                      }),
                    ]}
                  >
                    Create
                  </button>
                  <button
                    type="button"
                    disabled={selectedId === null || !(draft.name.trim() && draft.surname.trim())}
                    mix={[
                      buttonCss,
                      on('click', () => {
                        state.update((draft) => {
                          if (draft.selectedId === null) return
                          let person = draft.people.find((person) => person.id === draft.selectedId)
                          if (person) Object.assign(person, draft.draft)
                        })
                      }),
                    ]}
                  >
                    Update
                  </button>
                  <button
                    type="button"
                    disabled={selectedId === null}
                    mix={[
                      buttonCss,
                      on('click', () => {
                        state.update((draft) => {
                          if (draft.selectedId === null) return
                          let index = draft.people.findIndex(
                            (person) => person.id === draft.selectedId,
                          )
                          if (index !== -1) draft.people.splice(index, 1)
                          draft.selectedId = null
                          draft.draft.name = ''
                          draft.draft.surname = ''
                        })
                      }),
                    ]}
                  >
                    Delete
                  </button>
                </div>
              </>
            )
          }}
        </div>
      </div>
    </section>
  )
})
