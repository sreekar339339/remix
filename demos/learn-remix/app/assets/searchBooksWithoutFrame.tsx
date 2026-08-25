import { clientEntry, css, on, ref, type Handle } from 'remix/ui'
import { routes } from '../routes.ts'
import { Events, evented as e, type CustomEventsDefined, type EventsApi } from './utils/customEvents/index.tsx'

type Book = {
  title: string
}

type SearchView =
  | { type: 'queryEmpty' }
  | { type: 'querySubmitted'; query: string }
  | { type: 'booksFound'; books: Array<Book> }
  | { type: 'booksNotFound'; reason: 'emptyList' | { other: string } }
  | { type: 'errorOccurred'; error: Error }

class SearchEvents extends Events {
  view: SearchView
  constructor(_api: EventsApi<SearchEvents>, view: SearchView) {
    super()
    this.view = view
  }
}

async function fetchBooks(
  events: CustomEventsDefined<SearchEvents>,
  query: string,
  input: HTMLInputElement,
  signal: AbortSignal,
) {
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
        events.create({ view: { type: 'booksNotFound', reason: { other: json.detail[0].msg } } }),
      )
    }
    let books = json.docs as Array<Book>
    input.dispatchEvent(
      events.create({
        view: books.length
          ? { type: 'booksFound', books }
          : { type: 'booksNotFound', reason: 'emptyList' },
      }),
    )
  } catch (error) {
    // A stale search's abort must not surface an error view.
    if (signal.aborted) return
    input.dispatchEvent(events.create({ view: { type: 'errorOccurred', error: error as Error } }))
  }
}

export const SearchBooksWithoutFrame = clientEntry(
  import.meta.url,
  function SearchBooksWithoutFrame(handle: Handle<{ initialQuery: string }>) {
    let initialQuery = handle.props.initialQuery.trim()
    let events = SearchEvents.define(initialQuery ? { type: 'querySubmitted', query: initialQuery } : { type: 'queryEmpty' },
    )
    let interacted = false
    let inputElement: HTMLInputElement | undefined

    function dispatchView(view: SearchView) {
      if (inputElement) inputElement.dispatchEvent(events.create({ view }))
    }

    return () => (
      <div mix={events.asHost()}>
        <label>
          Search{' '}
          <e.input
            on={events.on.view}
            type="text"
            defaultValue={initialQuery}
            class={(view) => (view.type === 'querySubmitted' ? 'pending' : '')}
            mix={[
              inputCss,
              on('input', ({ currentTarget }, signal) => {
                interacted = true
                let query = currentTarget.value.trim()
                if (!query) return void dispatchView({ type: 'queryEmpty' })
                dispatchView({ type: 'querySubmitted', query })
                fetchBooks(events, query, currentTarget, signal)
              }),
              events.on['*'](({ currentTarget, detail }) => {
                if (detail.type !== 'querySubmitted') currentTarget.select()
              }),
              ref((input, signal) => {
                inputElement = input
                queueMicrotask(() => {
                  if (!signal.aborted && !interacted) {
                    input.dispatchEvent(new InputEvent('input'))
                  }
                })
              }),
            ]}
          />
        </label>
        <e.div on={events.on.view}>
          {(view) => {
            switch (view.type) {
              case 'queryEmpty':
                return <p>Enter the title of any book.</p>
              case 'querySubmitted':
                return <p>{`fetching books with title containing "${view.query}"...`}</p>
              case 'booksFound':
                return (
                  <ul>
                    {view.books.map((book) => (
                      <li>{book.title}</li>
                    ))}
                  </ul>
                )
              case 'booksNotFound':
                if (view.reason === 'emptyList') {
                  return <p>No books were found for this title at this time.</p>
                }
                return (
                  <p>Could not fetch books for this title. Reason: {view.reason.other}.</p>
                )
              case 'errorOccurred':
                return (
                  <p>
                    Unexpected error occured, try again! {view.error.message}
                    Cause: {view.error.cause as string}.
                  </p>
                )
            }
          }}
        </e.div>
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