import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import type { FrameContent } from 'remix/ui'
import { render } from 'remix/ui/test'
import { routes } from '../routes.ts'
import { SearchBooksWithFrame } from './searchBooksWithFrame.tsx'

type PendingFrame = {
  src: string
  signal: AbortSignal
  resolve(content: FrameContent): void
}

async function settleFrame() {
  await Promise.resolve()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  await Promise.resolve()
}

describe('SearchBooksWithFrame', () => {
  it('renders an initial query through a frame', async (t) => {
    let sources: string[] = []
    let result = render(<SearchBooksWithFrame initialQuery="  dune  " />, {
      frameInit: {
        resolveFrame(src) {
          sources.push(src)
          return <p>Dune result</p>
        },
      },
    })
    t.after(() => result.cleanup())

    assert.equal((result.$('input') as HTMLInputElement).value, 'dune')
    assert.match(result.container.textContent ?? '', /fetching.+dune/)

    await result.act(settleFrame)

    assert.deepEqual(sources, [
      routes.searchBooks.books.href(undefined, { searchParams: { q: 'dune' } }),
    ])
    assert.match(result.container.textContent ?? '', /Dune result/)
  })

  it('moves between empty and submitted query views', async (t) => {
    let selections = 0
    let requests: PendingFrame[] = []
    t.mock.method(HTMLInputElement.prototype, 'select', () => {
      selections++
    })

    let result = render(<SearchBooksWithFrame initialQuery="" />, {
      frameInit: {
        resolveFrame(src, options) {
          let signal = options?.signal
          assert.ok(signal)
          return new Promise<FrameContent>((resolve) => {
            requests.push({ src, signal, resolve })
          })
        },
      },
    })
    t.after(() => result.cleanup())
    let form = result.$('form') as HTMLFormElement
    let input = result.$('input') as HTMLInputElement

    assert.match(result.container.textContent ?? '', /Enter the title of any book/)
    assert.equal(requests.length, 0)

    input.value = '  dune  '
    await result.act(async () => {
      form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
      await settleFrame()
    })

    assert.equal(requests.length, 1)
    assert.equal(
      requests[0].src,
      routes.searchBooks.books.href(undefined, { searchParams: { q: 'dune' } }),
    )
    assert.match(result.container.textContent ?? '', /fetching.+dune/)

    input.value = '   '
    await result.act(async () => {
      form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
      await settleFrame()
    })

    assert.equal(requests[0].signal.aborted, true)
    assert.equal(selections, 1)
    assert.match(result.container.textContent ?? '', /Enter the title of any book/)

    input.value = 'foundation'
    await result.act(async () => {
      form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
      await settleFrame()
    })
    await result.act(async () => {
      requests[1].resolve(<p>Foundation result</p>)
      await settleFrame()
    })

    assert.match(result.container.textContent ?? '', /Foundation result/)
  })
})
