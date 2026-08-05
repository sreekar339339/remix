import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import type { RenderResult } from 'remix/ui/test'
import { render } from 'remix/ui/test'
import { routes } from '../routes.ts'
import { SearchBooksWithoutFrame } from './searchBooksWithoutFrame.tsx'

type PendingSearch = {
  query: string
  signal: AbortSignal
  resolve(books: Array<{ title: string }>): void
}

async function settleSearch() {
  await Promise.resolve()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  await Promise.resolve()
}

async function search(result: RenderResult, input: HTMLInputElement, query: string) {
  input.value = query
  await result.act(async () => {
    input.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        data: query.at(-1) ?? null,
        inputType: 'insertText',
      }),
    )
    await settleSearch()
  })
}

describe('SearchBooksWithoutFrame', () => {
  it('renders and applies the empty-query transition on mount', async (t) => {
    let selections = 0
    let fetches = 0
    t.mock.method(HTMLInputElement.prototype, 'select', () => {
      selections++
    })
    t.mock.method(window, 'fetch', () => {
      fetches++
      return Promise.reject(new Error('empty queries must not be fetched'))
    })

    let result = render(<SearchBooksWithoutFrame initialQuery="" />)
    t.after(() => result.cleanup())

    assert.match(result.container.textContent ?? '', /Enter the title of any book/)

    await result.act(settleSearch)

    assert.equal(fetches, 0)
    assert.equal(selections, 1)
  })

  it('starts and resolves the initial populated query', async (t) => {
    let request:
      | {
          url: string
          resolve(response: Response): void
        }
      | undefined

    t.mock.method(window, 'fetch', (input: RequestInfo) => {
      let url = typeof input === 'string' ? input : input.url
      return new Promise<Response>((resolve) => {
        request = { url, resolve }
      })
    })

    let result = render(<SearchBooksWithoutFrame initialQuery="  dune  " />)
    t.after(() => result.cleanup())
    let input = result.$('input') as HTMLInputElement

    assert.equal(input.value, 'dune')
    assert.equal(input.classList.contains('pending'), true)
    assert.match(result.container.textContent ?? '', /fetching.+dune/)

    await result.act(settleSearch)
    let initialRequest = request
    assert.ok(initialRequest)
    assert.equal(
      initialRequest.url,
      routes.searchBooks.books.href(undefined, { searchParams: { q: 'dune' } }),
    )

    await result.act(async () => {
      initialRequest.resolve(new Response(JSON.stringify({ docs: [{ title: 'Dune' }] })))
      await settleSearch()
    })

    assert.equal(input.classList.contains('pending'), false)
    assert.deepEqual(
      [...result.container.querySelectorAll('li')].map((item) => item.textContent),
      ['Dune'],
    )
  })

  it('renders found, empty, invalid, and failed search outcomes', async (t) => {
    let requestedQueries: string[] = []
    t.mock.method(window, 'fetch', (input: RequestInfo) => {
      let url = typeof input === 'string' ? input : input.url
      let query = new URL(url, window.location.href).searchParams.get('q') ?? ''
      requestedQueries.push(query)

      switch (query) {
        case 'dune':
          return Promise.resolve(
            new Response(
              JSON.stringify({
                docs: [{ title: 'Dune' }, { title: 'Dune Messiah' }],
              }),
            ),
          )
        case 'missing':
          return Promise.resolve(new Response(JSON.stringify({ docs: [] })))
        case 'invalid':
          return Promise.resolve(
            new Response(JSON.stringify({ detail: [{ msg: 'Invalid search query' }] })),
          )
        case 'failed':
          return Promise.resolve(
            new Response('upstream unavailable', {
              status: 503,
              statusText: 'Service Unavailable',
            }),
          )
        default:
          throw new Error(`Unexpected query: ${query}`)
      }
    })

    let result = render(<SearchBooksWithoutFrame initialQuery="" />)
    t.after(() => result.cleanup())
    let input = result.$('input') as HTMLInputElement
    await result.act(settleSearch)

    await search(result, input, 'dune')
    await result.act(settleSearch)
    assert.deepEqual(
      [...result.container.querySelectorAll('li')].map((item) => item.textContent),
      ['Dune', 'Dune Messiah'],
    )

    await search(result, input, 'missing')
    await result.act(settleSearch)
    assert.match(result.container.textContent ?? '', /No books were found for this title/)

    await search(result, input, 'invalid')
    await result.act(settleSearch)
    assert.match(result.container.textContent ?? '', /Could not fetch.+Invalid search query/)

    await search(result, input, 'failed')
    await result.act(settleSearch)
    assert.match(
      result.container.textContent ?? '',
      /Unexpected error occured.+503 Service Unavailable.+upstream unavailable/,
    )

    await search(result, input, '   ')
    assert.match(result.container.textContent ?? '', /Enter the title of any book/)
    assert.deepEqual(requestedQueries, ['dune', 'missing', 'invalid', 'failed'])
  })

  it('aborts stale searches and renders only the latest result', async (t) => {
    let requests: PendingSearch[] = []

    t.mock.method(window, 'fetch', (input: RequestInfo, init?: RequestInit) => {
      let url = typeof input === 'string' ? input : input.url
      let query = new URL(url, window.location.href).searchParams.get('q') ?? ''
      let signal = init?.signal
      assert.ok(signal instanceof AbortSignal)

      return new Promise<Response>((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        })
        requests.push({
          query,
          signal,
          resolve(books) {
            resolve(
              new Response(JSON.stringify({ docs: books }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              }),
            )
          },
        })
      })
    })

    let result = render(<SearchBooksWithoutFrame initialQuery="" />)
    t.after(() => result.cleanup())
    let input = result.$('input') as HTMLInputElement
    await result.act(settleSearch)

    await search(result, input, 'du')
    await search(result, input, 'dune')
    await result.act(settleSearch)

    assert.equal(requests.length, 2)
    assert.equal(requests[0].query, 'du')
    assert.equal(requests[0].signal.aborted, true)
    assert.equal(requests[1].query, 'dune')
    assert.equal(requests[1].signal.aborted, false)
    assert.match(result.container.textContent ?? '', /fetching.+dune/)

    await result.act(async () => {
      requests[1].resolve([{ title: 'Dune' }, { title: 'Dune Messiah' }])
      await settleSearch()
    })

    assert.deepEqual(
      [...result.container.querySelectorAll('li')].map((item) => item.textContent),
      ['Dune', 'Dune Messiah'],
    )
    assert.doesNotMatch(result.container.textContent ?? '', /Unexpected error/)
  })
})
