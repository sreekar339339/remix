import { clientEntry, css, Frame, on, ref, type Handle } from 'remix/ui'
import { routes } from '../routes.ts'
import { customEvents, evented } from './utils/customEvents/index.tsx'

export const SearchBooksWithFrame = clientEntry(
  import.meta.url,
  function SearchBooksWithFrame(handle: Handle<{ initialQuery?: string }>) {
    let events = customEvents<'queryEmpty' | 'querySubmitted'>()
    let query = handle.props.initialQuery?.trim() ?? ''
    let initialEvent = events.create(query ? 'querySubmitted' : 'queryEmpty')

    return () => (
      <div mix={events.asHost}>
        <form
          action={routes.searchBooks.books.href()}
          mix={[
            on('submit', (evt) => {
              evt.preventDefault()
              query = (new FormData(evt.currentTarget).get('q') as string).trim()
              evt.currentTarget.dispatchEvent(
                query ? events.create('querySubmitted') : events.create('queryEmpty'),
              )
            }),
          ]}
        >
          <label>
            Search{' '}
            <input
              name="q"
              type="text"
              defaultValue={query}
              mix={[
                css({
                  padding: 4,
                  '&.pending': {
                    backgroundImage:
                      'linear-gradient(100deg, transparent 0%, transparent 35%, rgba(45, 172, 249, 0.28) 50%, transparent 65%, transparent 100%)',
                    backgroundSize: '220% 100%',
                    animation: 'glimmer 1.15s linear infinite',
                  },
                }),
                events.queryEmpty.on(({ currentTarget }) => {
                  currentTarget.select()
                }),
              ]}
            />
          </label>
        </form>
        <evented.div eventSource={events} initial={initialEvent}>
          {(result, event) => {
            switch (event.type) {
              case 'queryEmpty':
                return <p>Enter the title of any book.</p>
              case 'querySubmitted':
                return (
                  <Frame
                    key={query}
                    fallback={<p>fetching books with title containing "{query}"...</p>}
                    src={routes.searchBooks.books.href(undefined, { searchParams: { q: query } })}
                  />
                )
            }
          }}
        </evented.div>
      </div>
    )
  },
)
