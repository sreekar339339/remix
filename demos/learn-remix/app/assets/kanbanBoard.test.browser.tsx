import * as assert from 'remix/assert'
import { it } from 'remix/test'
import { createRoot } from 'remix/ui'
import { KanbanBoard } from './kanbanBoard.tsx'

it('re-renders whole-key views and routes per-item elements on a deep card update', async (t) => {
  let captured: unknown
  let container = document.createElement('div')
  document.body.appendChild(container)
  let root = createRoot(container)
  root.addEventListener('error', (event) => {
    captured = (event as ErrorEvent).error ?? event
  })
  root.render(<KanbanBoard />)
  root.flush()
  t.after(() => {
    root.dispose()
    container.remove()
  })
  if (captured !== undefined) {
    throw new Error(
      'CAPTURED: ' +
        (captured instanceof Error
          ? captured.stack?.split('\n').slice(0, 6).join(' | ')
          : String(captured)),
    )
  }
  let $ = (selector: string) => container.querySelector<HTMLElement>(selector)
  let act = async (fn: () => unknown | Promise<unknown>) => {
    await fn()
    root.flush()
  }

  let backlog = $('[aria-label="Backlog view"]') as HTMLOutputElement
  let building = $('[aria-label="Building view"]') as HTMLOutputElement
  let design = $('[aria-label="Review interaction design"]') as HTMLElement
  let metrics = $('[aria-label="Define success metrics"]') as HTMLElement
  let routing = $('[aria-label="Prototype deep patch routing"]') as HTMLElement

  assert.equal(backlog.textContent, '0 urgent · rendered 1')
  assert.equal(building.textContent, '1 urgent · rendered 1')
  assert.match(design.textContent ?? '', /Normal · rendered 1×/)
  assert.match(metrics.textContent ?? '', /Normal · rendered 1×/)
  assert.match(routing.textContent ?? '', /Urgent · rendered 1×/)

  let toggle = $('[aria-label="Toggle Review interaction design urgency"]') as HTMLButtonElement
  await act(() => toggle.click())
  await act(() => Promise.resolve())

  backlog = $('[aria-label="Backlog view"]') as HTMLOutputElement
  building = $('[aria-label="Building view"]') as HTMLOutputElement
  design = $('[aria-label="Review interaction design"]') as HTMLElement
  metrics = $('[aria-label="Define success metrics"]') as HTMLElement
  routing = $('[aria-label="Prototype deep patch routing"]') as HTMLElement

  // The deep patch re-renders whole-key views; with component-owned `evented`
  // elements the routed update coalesces with the parent diff, so the owning
  // column/card renders once (not twice) for the same entry.
  assert.equal(backlog.textContent, '1 urgent · rendered 2')
  assert.equal(building.textContent, '1 urgent · rendered 2')
  assert.match(design.textContent ?? '', /Urgent · rendered 2×/)
  assert.match(metrics.textContent ?? '', /Normal · rendered 2×/)
  assert.match(routing.textContent ?? '', /Urgent · rendered 2×/)
})