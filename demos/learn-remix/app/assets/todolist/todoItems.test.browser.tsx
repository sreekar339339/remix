import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import type { Handle } from 'remix/ui'
import { render } from 'remix/ui/test'
import { TodoItems } from './todoItems.tsx'

async function settleAction() {
  await Promise.resolve()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  await Promise.resolve()
}

describe('TodoItems', () => {
  it('keeps an edited value visible through submit and frame reload', async (t) => {
    let resolveRequest: ((response: Response) => void) | undefined
    let resolveReload: ((signal: AbortSignal) => void) | undefined
    t.mock.method(
      window,
      'fetch',
      () =>
        new Promise<Response>((resolve) => {
          resolveRequest = resolve
        }),
    )

    function TodoItemsWithControlledReload(handle: Handle) {
      handle.frame.reload = () =>
        new Promise<AbortSignal>((resolve) => {
          resolveReload = resolve
        })
      return () => <TodoItems todos={[{ id: 'first', completed: false, text: 'Original' }]} />
    }
    let result = render(<TodoItemsWithControlledReload />)
    t.after(() => result.cleanup())

    let input = result.$('input[name="text"]') as HTMLInputElement
    let form = input.form!
    let submitter = form.querySelector<HTMLButtonElement>('button[name="intent"][value="update"]')!
    input.value = 'Edited'
    input.focus()
    assert.equal(document.activeElement, input)

    await result.act(async () => {
      submitter.click()
      await settleAction()
    })

    assert.equal(input.value, 'Edited')
    assert.equal(input.disabled, true)
    assert.equal(form.dataset.action, 'actionSubmitted')
    assert.equal(result.$('input[name="text"]'), input)

    await result.act(async () => {
      resolveRequest?.(new Response(null, { status: 204 }))
      await settleAction()
    })

    assert.ok(resolveReload)
    assert.equal(input.value, 'Edited')
    assert.equal(input.disabled, true)
    assert.equal(result.$('input[name="text"]'), input)

    await result.act(async () => {
      resolveReload?.(new AbortController().signal)
      await settleAction()
    })

    assert.equal(input.value, 'Edited')
    assert.equal(input.disabled, false)
    assert.equal(form.dataset.action, 'actionSucceeded')
    assert.equal(result.$('input[name="text"]'), input)
  })

  it('keeps pending action events scoped to their row', async (t) => {
    let resolveRequest: ((response: Response) => void) | undefined
    t.mock.method(
      window,
      'fetch',
      () =>
        new Promise<Response>((resolve) => {
          resolveRequest = resolve
        }),
    )

    let result = render(
      <TodoItems
        todos={[
          { id: 'first', completed: false, text: 'First' },
          { id: 'second', completed: false, text: 'Second' },
        ]}
      />,
    )
    t.after(() => result.cleanup())

    let deleteButtons = [
      ...result.container.querySelectorAll<HTMLButtonElement>(
        'button[name="intent"][value="delete"]',
      ),
    ]
    assert.equal(deleteButtons.length, 2)

    await result.act(() => deleteButtons[0].click())
    assert.equal(deleteButtons[0].disabled, true)
    assert.equal(deleteButtons[1].disabled, false)

    await result.act(async () => {
      resolveRequest?.(
        new Response('Could not delete', {
          status: 500,
          statusText: 'Failed',
        }),
      )
      await settleAction()
    })

    assert.equal(deleteButtons[0].disabled, false)
    assert.equal(deleteButtons[1].disabled, false)
  })
})
