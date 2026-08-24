import { clientEntry, css, Fragment, on } from 'remix/ui'
import { Events, evented } from '../utils/customEvents/index.tsx'
import { buttonCss, inputCss, rowCss, taskCss } from './styles.ts'

type Person = {
  id: number
  name: string
  surname: string
}

function visiblePeople(people: readonly Person[], prefix: string) {
  return people.filter((person) => person.surname.toLowerCase().startsWith(prefix.toLowerCase()))
}

class SevenGuisCrudEvents extends Events {
  people: Person[] = [
    { id: 1, name: 'Hans', surname: 'Emil' },
    { id: 2, name: 'Max', surname: 'Mustermann' },
    { id: 3, name: 'Roman', surname: 'Tisch' },
  ]
  prefix = ''
  selectedId = null as number | null
  draft = { name: '', surname: '' }
  nextId = 4

  select(id: number | null) {
    this.selectedId = id
    let person = this.people.find((candidate: Person) => candidate.id === id)
    if (!person) return
    this.draft.name = person.name
    this.draft.surname = person.surname
  }

  create() {
    let person = { id: this.nextId, ...this.draft }
    this.people.push(person)
    this.selectedId = person.id
    this.nextId += 1
  }

  update() {
    if (this.selectedId === null) return
    let person = this.people.find((candidate: Person) => candidate.id === this.selectedId)
    if (!person) return
    person.name = this.draft.name
    person.surname = this.draft.surname
  }

  delete() {
    if (this.selectedId === null) return
    this.people = this.people.filter((person: Person) => person.id !== this.selectedId)
    this.selectedId = null
    this.draft.name = ''
    this.draft.surname = ''
  }
}

export const SevenGuisCrud = clientEntry(import.meta.url, function SevenGuisCrud() {
  let events = SevenGuisCrudEvents.define()

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
              events.dispatchEvent({ select: Number(currentTarget.value) })
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
                      events.dispatchEvent({
                        draft: { ...events.detail.draft, name: currentTarget.value },
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
                        draft: { ...draft, surname: currentTarget.value },
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
          )}
        </evented.div>
      </div>
    </section>
  )
})
