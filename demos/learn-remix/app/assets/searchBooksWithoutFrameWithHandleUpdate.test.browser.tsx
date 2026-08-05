import * as assert from 'remix/assert'
import { it } from 'remix/test'
import { render } from 'remix/ui/test'
import { SearchBooksWithoutFrameWithHandleUpdate } from './searchBooksWithoutFrameWithHandleUpdate.tsx'

async function settleSearch() {
  await Promise.resolve()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  await Promise.resolve()
}

it('centralizes search view updates without event-aware elements', async (t) => {
  let resolveRequest: ((response: Response) => void) | undefined
  t.mock.method(
    window,
    'fetch',
    () =>
      new Promise<Response>((resolve) => {
        resolveRequest = resolve
      }),
  )

  let result = render(<SearchBooksWithoutFrameWithHandleUpdate initialQuery="" />)
  t.after(() => result.cleanup())
  await result.act(settleSearch)

  let input = result.$('input') as HTMLInputElement
  assert.match(result.container.textContent ?? '', /Enter the title of any book/)

  input.value = 'dune'
  await result.act(async () => {
    input.dispatchEvent(new InputEvent('input', { bubbles: true }))
    await settleSearch()
  })

  assert.equal(result.$('input'), input)
  assert.equal(input.classList.contains('pending'), true)
  assert.match(result.container.textContent ?? '', /fetching.+dune/)
  assert.ok(resolveRequest)

  await result.act(async () => {
    resolveRequest!(new Response(JSON.stringify({ docs: [{ title: 'Dune' }] })))
    await settleSearch()
  })

  assert.equal(result.$('input'), input)
  assert.equal(input.classList.contains('pending'), false)
  assert.deepEqual(
    [...result.container.querySelectorAll('li')].map((item) => item.textContent),
    ['Dune'],
  )
})
