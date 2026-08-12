import { clientEntry, css, on, ref, type Handle } from 'remix/ui'
import { routes } from '../routes.ts'
import { customEvents, type CustomEventsEventMap } from './utils/customEvents/index.tsx'

type Book = {
  title: string
}

type SearchEvents = {
  booksFound: Array<Book>
  booksNotFound: { reason: 'emptyList' | { other: string } }
  errorOccurred: Error
  queryEmpty: null
  querySubmitted: { query: string }
}

type SearchEvent = CustomEventsEventMap<SearchEvents>[keyof SearchEvents]

const events = customEvents<SearchEvents>()

async function fetchBooks(query: string, input: HTMLInputElement, signal: AbortSignal) {
  let options = { signal }
  try {
    let response = await fetch(
      routes.searchBooks.books.href(undefined, { searchParams: { q: query } }),
      {
        signal,
        headers: { 'Content-Type': 'application/json' },
      },
    )
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`, {
        cause: await response.text(),
      })
    }

    let json = await response.json()
    if (!('docs' in json)) {
      input.dispatchEvent(
        events('booksNotFound', { reason: { other: json.detail[0].msg } }, options),
      )
      return
    }

    let books = json.docs as Array<Book>
    input.dispatchEvent(
      books.length
        ? events('booksFound', books, options)
        : events('booksNotFound', { reason: 'emptyList' }, options),
    )
  } catch (error) {
    input.dispatchEvent(events('errorOccurred', error as Error, options))
  }
}

function renderResult(event: SearchEvent) {
  switch (event.type) {
    case 'queryEmpty':
      return <p>Enter the title of any book.</p>
    case 'querySubmitted':
      return <p>{`fetching books with title containing "${event.detail.query}"...`}</p>
    case 'booksFound':
      return (
        <ul>
          {event.detail.map((book) => (
            <li>{book.title}</li>
          ))}
        </ul>
      )
    case 'booksNotFound':
      return event.detail.reason === 'emptyList' ? (
        <p>No books were found for this title at this time.</p>
      ) : (
        <p>Could not fetch books for this title. Reason: {event.detail.reason.other}.</p>
      )
    case 'errorOccurred':
      return (
        <p>
          Unexpected error occured, try again! {event.detail.message}
          Cause: {event.detail.cause as string}.
        </p>
      )
  }
}

export const SearchBooksWithoutFrameWithHandleUpdate = clientEntry(
  import.meta.url,
  function SearchBooksWithoutFrameWithHandleUpdate(handle: Handle<{ initialQuery: string }>) {
    let initialQuery = handle.props.initialQuery.trim()
    let currentEvent: SearchEvent = initialQuery
      ? events('querySubmitted', { query: initialQuery })
      : events('queryEmpty')
    let interacted = false

    return () => (
      <div>
        <label>
          Search{' '}
          <input
            type="text"
            defaultValue={initialQuery}
            class={currentEvent.type === 'querySubmitted' ? 'pending' : ''}
            mix={[
              inputCss,
              on('input', ({ currentTarget }, signal) => {
                let query = currentTarget.value.trim()
                if (!query) {
                  currentTarget.dispatchEvent(events('queryEmpty'))
                  return
                }
                currentTarget.dispatchEvent(events('querySubmitted', { query }))
                fetchBooks(query, currentTarget, signal)
              }),
              events.on['*'](async (event) => {
                currentEvent = event
                let signal = await handle.update()
                if (!signal.aborted && event.type !== 'querySubmitted') {
                  event.currentTarget.select()
                }
              }),
              ref((element, signal) => {
                queueMicrotask(() => {
                  if (!signal.aborted && !interacted) {
                    element.dispatchEvent(new InputEvent('input'))
                  }
                })
              }),
            ]}
          />
        </label>
        <div>{renderResult(currentEvent)}</div>
      </div>
    )
  },
)

const inputCss = css({
  padding: 4,
  '&.pending': {
    backgroundImage:
      'linear-gradient(100deg, transparent 0%, transparent 35%, rgba(45, 172, 249, 0.28) 50%, transparent 65%, transparent 100%)',
    backgroundSize: '220% 100%',
    animation: 'glimmer 1.15s linear infinite',
    borderColor: 'var(--brand-blue)',
  },
  '@media (prefers-reduced-motion: reduce)': {
    animation: 'none',
  },
})
