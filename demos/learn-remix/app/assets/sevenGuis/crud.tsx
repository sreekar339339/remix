import { clientEntry, css, on } from 'remix/ui'
import { customEvents, evented } from '../utils/customEvents/index.tsx'
import { buttonCss, inputCss, rowCss, taskCss } from './styles.ts'

type Person = {
  id: number
  name: string
  surname: string
}

function visiblePeople(people: readonly Person[], prefix: string) {
  return people.filter((person) => person.surname.toLowerCase().startsWith(prefix.toLowerCase()))
}

export const SevenGuisCrud = clientEntry(import.meta.url, function SevenGuisCrud() {
  let events = customEvents(
    {
      people: [
        { id: 1, name: 'Hans', surname: 'Emil' },
        { id: 2, name: 'Max', surname: 'Mustermann' },
        { id: 3, name: 'Roman', surname: 'Tisch' },
      ],
      prefix: '',
      selectedId: null as number | null,
      draft: { name: '', surname: '' },
      nextId: 4,
    },
    {
      selectPerson: (draft, id: number) => {
        let person = draft.people.find((candidate) => candidate.id === id)
        if (!person) return
        draft.selectedId = person.id
        draft.draft.name = person.name
        draft.draft.surname = person.surname
      },
      create: (draft) => {
        let person = { id: draft.nextId, ...draft.draft }
        draft.people.push(person)
        draft.selectedId = person.id
        draft.nextId += 1
      },
      update: (draft) => {
        if (draft.selectedId === null) return
        let person = draft.people.find((candidate) => candidate.id === draft.selectedId)
        if (!person) return
        person.name = draft.draft.name
        person.surname = draft.draft.surname
      },
      delete: (draft) => {
        if (draft.selectedId === null) return
        let index = draft.people.findIndex((candidate) => candidate.id === draft.selectedId)
        if (index !== -1) draft.people.splice(index, 1)
        draft.selectedId = null
        draft.draft.name = ''
        draft.draft.surname = ''
      },
    },
  )
  return () => (
    <section mix={taskCss}>
      <h2>CRUD</h2>
      <label>
        Filter prefix{' '}
        <input
          aria-label="Filter prefix"
          defaultValue=""
          mix={[
            inputCss,
            on('input', ({ currentTarget }) => {
              events.dispatchEvent({ prefix: currentTarget.value })
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
              events.dispatchEvent({ selectPerson: Number(currentTarget.value) })
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
            let [draft, selectedId] = values as [{ name: string; surname: string }, number | null]
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
                        events.dispatchEvent({ draft: { ...draft, name: currentTarget.value } })
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
                        events.dispatchEvent({ draft: { ...draft, surname: currentTarget.value } })
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
                        events.dispatchEvent('create')
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
                        events.dispatchEvent('update')
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
                        events.dispatchEvent('delete')
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
