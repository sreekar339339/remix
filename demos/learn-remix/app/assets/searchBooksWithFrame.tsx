import { clientEntry, css, Frame, on, ref, type Handle } from 'remix/ui'
import { routes } from '../routes.ts'
import { Events, evented as e, type EventsApi } from './utils/customEvents/index.tsx'

class SearchBoxEvents extends Events {
  query: string | undefined
  constructor(_api: EventsApi<SearchBoxEvents>, query: string | undefined) {
    super()
    this.query = query
  }
  queryEmpty() {}
  querySubmitted() {}
}

export const SearchBooksWithFrame = clientEntry(
  import.meta.url,
  function SearchBooksWithFrame(handle: Handle<{ initialQuery?: string }>) {
    let query = handle.props.initialQuery?.trim() ?? ''
    let events = SearchBoxEvents.define(query || undefined)

    return () => (
      <div mix={events.asHost()}>
        <form
          action={routes.searchBooks.books.href()}
          mix={[
            on('submit', (evt) => {
              evt.preventDefault()
              query = (new FormData(evt.currentTarget).get('q') as string).trim()
              evt.currentTarget.dispatchEvent(events.create({ query: query || undefined }))
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
                events.on.queryEmpty(({ currentTarget }) => {
                  currentTarget.select()
                }),
              ]}
            />
          </label>
        </form>
        <e.div on={events.on.query}>
          {(submitted) =>
            submitted === undefined ? (
              <p>Enter the title of any book.</p>
            ) : (
              <Frame
                key={submitted}
                fallback={<p>fetching books with title containing "{submitted}"...</p>}
                src={routes.searchBooks.books.href(undefined, { searchParams: { q: submitted } })}
              />
            )
          }
        </e.div>
      </div>
    )
  },
)