import { clientEntry, css, on, ref, type Handle } from 'remix/ui'
import { routes } from '../routes.ts'
import { customEvents, evented } from './utils/customEvents/index.tsx'

type Book = {
  title: string
}

const events = customEvents<{
  booksFound: Array<Book>
  booksNotFound: { reason: 'emptyList' | { other: string } }
  errorOccurred: Error
  queryEmpty: null
  querySubmitted: { query: string }
}>()

async function fetchBooks(query: string, input: HTMLInputElement, signal: AbortSignal) {
  let opts = { signal }
  try {
    let response = await fetch(
      routes.searchBooks.books.href(undefined, { searchParams: { q: query } }),
      {
        signal,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`, {
        cause: await response.text(),
      })
    }
    let json = await response.json()
    if (!('docs' in json)) {
      return input.dispatchEvent(
        events.create('booksNotFound', { reason: { other: json.detail[0].msg } }, opts),
      )
    }
    let books = json.docs as Array<Book>
    input.dispatchEvent(
      books.length
        ? events.create('booksFound', books, opts)
        : events.create('booksNotFound', { reason: 'emptyList' }, opts),
    )
  } catch (error) {
    input.dispatchEvent(events.create('errorOccurred', error as Error, opts))
  } finally {
  }
}

export const SearchBooksWithoutFrame = clientEntry(
  import.meta.url,
  function SearchBooksWithoutFrame(handle: Handle<{ initialQuery: string }>) {
    let initialQuery = handle.props.initialQuery.trim()
    let initialEvent = initialQuery
      ? events.create('querySubmitted', { query: initialQuery })
      : events.create('queryEmpty')
    let interacted = false

    return () => (
      <div mix={events.asHost}>
        <label>
          Search{' '}
          <evented.input
            eventSource={events}
            initial={initialEvent}
            type="text"
            defaultValue={initialQuery}
            class={(detail, event) => (event.type === 'querySubmitted' ? 'pending' : '')}
            mix={[
              inputCss,
              on('input', ({ currentTarget }, signal) => {
                interacted = true
                let query = currentTarget.value.trim()
                if (!query) return void currentTarget.dispatchEvent(events.create('queryEmpty'))
                currentTarget.dispatchEvent(events.create('querySubmitted', { query }))
                fetchBooks(query, currentTarget, signal)
              }),
              events.on(({ currentTarget, type }) => {
                if (type !== 'querySubmitted') currentTarget.select()
              }),
              ref((input, signal) => {
                queueMicrotask(() => {
                  if (!signal.aborted && !interacted) {
                    input.dispatchEvent(new InputEvent('input'))
                  }
                })
              }),
            ]}
          />
        </label>
        <evented.div eventSource={events} initial={initialEvent}>
          {(detail, event) => {
            switch (event.type) {
              case 'queryEmpty':
                return <p>Enter the title of any book.</p>
              case 'querySubmitted':
                return (
                  <p>{`fetching books with title containing "${(detail as { query: string }).query}"...`}</p>
                )
              case 'booksFound':
                return (
                  <ul>
                    {(detail as Book[]).map((book) => (
                      <li>{book.title}</li>
                    ))}
                  </ul>
                )
              case 'booksNotFound':
                if (
                  (detail as { reason: 'emptyList' | { other: string } }).reason === 'emptyList'
                ) {
                  return <p>No books were found for this title at this time.</p>
                }
                return (
                  <p>
                    Could not fetch books for this title. Reason:{' '}
                    {(detail as { reason: { other: string } }).reason.other}.
                  </p>
                )
              case 'errorOccurred':
                return (
                  <p>
                    Unexpected error occured, try again! {(detail as Error).message}
                    Cause: {(detail as Error).cause as string}.
                  </p>
                )
            }
          }}
        </evented.div>
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
