import * as assert from 'remix/assert'
import { it } from 'remix/test'
import { render } from 'remix/ui/test'
import {
  ListUpdatesFeedBoard,
  ListUpdatesFilterBoard,
  ListUpdatesHeavyBoard,
} from './listUpdatesBoard.tsx'

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function settle() {
  for (let index = 0; index < 5; index++) await Promise.resolve()
}

function button(root: HTMLElement, section: string, label: string) {
  let match = [...root.querySelectorAll(`${section} button`)].find((node) =>
    node.textContent?.includes(label),
  )
  assert.ok(match, `expected ${section} button "${label}"`)
  return match as HTMLButtonElement
}

async function waitForBenchmark(root: HTMLElement, section: string, label: string) {
  let deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    await delay(50)
    let match = [...root.querySelectorAll(`${section} button`)].find((node) =>
      node.textContent?.includes(label),
    )
    if (match) return
  }
  assert.fail(`benchmark on ${section} did not finish`)
}

it('filters fine-grained and keeps rows across mode toggles', async (t) => {
  let result = render(<ListUpdatesFilterBoard />)
  t.after(() => result.cleanup())

  let rows = () => result.$('.filter-rows')!.querySelectorAll('.row')
  assert.equal(rows().length, 3000)

  let input = result.$('.filter-board input[type="search"]') as HTMLInputElement
  input.value = 'crimson'
  await result.act(() => input.dispatchEvent(new InputEvent('input')))
  await delay(30)
  assert.equal(rows().length, 300)
  assert.match(
    result.$('.filter-board')!.textContent!,
    /evented [\d.]+ ms\/tick \(\d+\)/,
    'timing meter accumulates evented ticks',
  )
  assert.ok(result.$('.filter-board')!.textContent?.includes('300 shown'))

  button(result.container, '.filter-board', 'Benchmark 30 ticks/mode').click()
  await result.act(() => {})
  await waitForBenchmark(result.container, '.filter-board', 'Benchmark 30 ticks/mode')
  assert.equal(
    button(result.container, '.filter-board', 'Benchmark 30 ticks/mode').textContent,
    'Benchmark 30 ticks/mode',
  )
  assert.match(
    result.$('.filter-board')!.textContent!,
    /plain [\d.]+ ms\/tick \(30\)/,
    'benchmark records plain ticks',
  )
  assert.match(
    result.$('.filter-board')!.textContent!,
    /evented [\d.]+ ms\/tick \(30\)/,
    'benchmark records evented ticks',
  )
  assert.equal(rows().length, 3000)

  input.value = 'crimson-widget-500'
  await result.act(() => input.dispatchEvent(new InputEvent('input')))
  await settle()
  assert.equal(rows().length, 3)

  input.value = 'crimson'
  await result.act(() => input.dispatchEvent(new InputEvent('input')))
  await settle()
  assert.equal(rows().length, 300)

  button(result.container, '.filter-board', 'Switch to plain re-render').click()
  await result.act(() => {})
  await settle()
  assert.equal(rows().length, 300)

  input.value = 'crimson-widget-500'
  await result.act(() => input.dispatchEvent(new InputEvent('input')))
  await settle()
  assert.equal(rows().length, 3)

  button(result.container, '.filter-board', 'Switch to evented').click()
  await result.act(() => {})
  await settle()
  assert.equal(rows().length, 3)
})

it('applies feed bursts in evented and plain modes', async (t) => {
  let result = render(<ListUpdatesFeedBoard />)
  t.after(() => result.cleanup())

  let rows = () => result.$('.feed-rows')!.querySelectorAll('.row')
  assert.equal(rows().length, 50)

  button(result.container, '.feed-board', 'Start feed').click()
  await result.act(() => {})
  await delay(1200)
  await settle()
  let afterBursts = rows().length
  assert.ok(afterBursts > 50 && afterBursts <= 130, `rows after feed bursts: ${afterBursts}`)
  assert.match(
    result.$('.feed-board')!.textContent!,
    /evented [\d.]+ ms\/tick \(\d+\)/,
    'timing meter accumulates evented ticks',
  )

  button(result.container, '.feed-board', 'Pause feed').click()
  await result.act(() => {})
  await delay(500)
  assert.equal(rows().length, afterBursts)

  button(result.container, '.feed-board', 'Feed now').click()
  await result.act(() => {})
  await settle()
  assert.equal(rows().length, afterBursts + 10)

  button(result.container, '.feed-board', 'Switch to plain re-render').click()
  await result.act(() => {})
  await settle()
  button(result.container, '.feed-board', 'Feed now').click()
  await result.act(() => {})
  await settle()
  assert.equal(rows().length, afterBursts + 20)
  let feedText = result.$('.feed-board')!.textContent!
  assert.match(feedText, /plain [\d.]+ ms\/tick \(\d+\)/, 'timing meter accumulates plain ticks')
  assert.match(feedText, /time saved \d+%/, 'timing meter reports time saved')
})

it('updates single heavy rows fine-grained and re-renders all in plain mode', async (t) => {
  let result = render(<ListUpdatesHeavyBoard />)
  t.after(() => result.cleanup())

  let rows = () => result.$('.heavy-rows')!.querySelectorAll('.row')
  assert.equal(rows().length, 200)

  let edits = () =>
    [...result.$$('.heavy-rows .row')].filter((row) => row.textContent?.includes('1 edits'))

  result.$('.heavy-rows .row button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await result.act(() => {})
  await settle()
  assert.equal(edits().length, 1)

  button(result.container, '.heavy-board', 'Bump all priorities').click()
  await result.act(() => {})
  await delay(30)
  assert.match(
    result.$('.heavy-board')!.textContent!,
    /evented [\d.]+ ms\/tick \(\d+\)/,
    'timing meter accumulates evented ticks',
  )

  button(result.container, '.heavy-board', 'Switch to plain re-render').click()
  await result.act(() => {})
  await settle()
  assert.equal(rows().length, 200)

  result
    .$$('.heavy-rows .row')[1]!
    .querySelector('button')!
    .dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await result.act(() => {})
  await settle()
  assert.equal(edits().length, 2)
})
