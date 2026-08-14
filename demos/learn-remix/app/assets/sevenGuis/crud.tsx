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
  let events = customEvents({
    root: {
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

    // The fold shadows the selectedId detail: dispatching selectedId sets the
    // selection and derives the draft from the chosen person.
    selectedId: (id: number | null, root) => {
      root.selectedId = id
      let person = root.people.find((candidate: Person) => candidate.id === id)
      if (!person) return
      root.draft.name = person.name
      root.draft.surname = person.surname
    },

    createPerson: (_detail, root) => {
      let person = { id: root.nextId, ...root.draft }
      root.people.push(person)
      root.selectedId = person.id
      root.nextId += 1
    },
    update: (_detail, root) => {
      if (root.selectedId === null) return
      let person = root.people.find((candidate) => candidate.id === root.selectedId)
      if (!person) return
      person.name = root.draft.name
      person.surname = root.draft.surname
    },
    delete: (_detail, root) => {
      if (root.selectedId === null) return
      let index = root.people.findIndex((candidate) => candidate.id === root.selectedId)
      if (index !== -1) root.people.splice(index, 1)
      root.selectedId = null
      root.draft.name = ''
      root.draft.surname = ''
    },
  })

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
          eventSource={[events.on.people, events.on.prefix, events.on.selectedId]}
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
          eventSource={[events.on.draft, events.on.selectedId]}
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
                      events.dispatchEvent({
                        draft: (root) => ({ ...root.draft, name: currentTarget.value }),
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
                      events.dispatchEvent({
                        draft: (root) => ({ ...root.draft, surname: currentTarget.value }),
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
