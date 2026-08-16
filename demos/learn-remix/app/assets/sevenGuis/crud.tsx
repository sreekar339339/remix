import { clientEntry, css, Fragment, on } from 'remix/ui'
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

      // The fold shadows the selectedId detail: dispatching selectedId sets the
      // selection and derives the draft from the chosen person.
    },
    {
      selectedId: (id: number | null, detail) => {
        detail.selectedId = id
        let person = detail.people.find((candidate: Person) => candidate.id === id)
        if (!person) return
        detail.draft.name = person.name
        detail.draft.surname = person.surname
      },
      createPerson: (_detail, detail) => {
        let person = { id: detail.nextId, ...detail.draft }
        detail.people.push(person)
        detail.selectedId = person.id
        detail.nextId += 1
      },
      update: (_detail, detail) => {
        if (detail.selectedId === null) return
        let person = detail.people.find((candidate) => candidate.id === detail.selectedId)
        if (!person) return
        person.name = detail.draft.name
        person.surname = detail.draft.surname
      },
      delete: (_detail, detail) => {
        if (detail.selectedId === null) return
        let index = detail.people.findIndex((candidate) => candidate.id === detail.selectedId)
        if (index !== -1) detail.people.splice(index, 1)
        detail.selectedId = null
        detail.draft.name = ''
        detail.draft.surname = ''
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
        <evented.select
          on={[events.on.people, events.on.prefix, events.on.selectedId]}
          size={7}
          aria-label="People"
          value={([, , selectedId]) => selectedId ?? ''}
          mix={[
            inputCss,
            on('change', ({ currentTarget }) => {
              events.dispatchEvent({ selectedId: Number(currentTarget.value) })
            }),
          ]}
        >
          {([people, prefix]) =>
            visiblePeople(people, prefix).map((person) => (
              <option value={person.id}>
                {person.surname}, {person.name}
              </option>
            ))
          }
        </evented.select>
        <evented.div
          on={[events.on.draft, events.on.selectedId]}
          mix={css({ display: 'grid', gap: 8 })}
        >
          {([draft, selectedId]) => (
            <>
              <label>
                Name{' '}
                <input
                  aria-label="Name"
                  value={draft.name}
                  mix={[
                    inputCss,
                    on('input', ({ currentTarget }) => {
                      events.dispatchEvent((detail) => ({
                        draft: { ...detail.draft, name: currentTarget.value },
                      }))
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
                      events.dispatchEvent((detail) => ({
                        draft: { ...detail.draft, surname: currentTarget.value },
                      }))
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
                      events.dispatchEvent('createPerson')
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
          )}
        </evented.div>
      </div>
    </section>
  )
})
