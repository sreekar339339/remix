import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { on, type Handle } from 'remix/ui'
import { render } from 'remix/ui/test'
import { draggable } from './draggable.tsx'

describe('draggable custom events', () => {
  it('dispatches drag start and end events from the draggable element', async (t) => {
    function DraggableCard(handle: Handle) {
      return () => (
        <div
          role="group"
          aria-label="draggable-card"
          style={{ left: '12px', top: '8px' }}
          mix={[
            draggable(true),
            draggable.events.start.on(({ currentTarget, detail, target }) => {
              currentTarget.dataset.startPosition = `${detail.left},${detail.top}`
              currentTarget.dataset.startTargetIsCard = String(target === currentTarget)
            }),
            draggable.events.end.on(({ currentTarget, detail, target }) => {
              currentTarget.dataset.endPosition = `${detail.left},${detail.top}`
              currentTarget.dataset.endTargetIsCard = String(target === currentTarget)
            }),
          ]}
        >
          Drag me
        </div>
      )
    }

    let result = render(<DraggableCard />)
    t.after(() => result.cleanup())

    let card = result.$('[role="group"][aria-label="draggable-card"]') as HTMLDivElement
    Object.defineProperty(card, 'setPointerCapture', {
      configurable: true,
      value() {},
    })

    await result.act(() => {
      card.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          button: 0,
          clientX: 20,
          clientY: 30,
          pointerId: 1,
        }),
      )
    })

    assert.equal(card.dataset.startPosition, '12,8')
    assert.equal(card.dataset.startTargetIsCard, 'true')

    await result.act(() => {
      window.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          clientX: 35,
          clientY: 55,
          pointerId: 1,
        }),
      )
    })

    assert.equal(card.style.left, '27px')
    assert.equal(card.style.top, '33px')

    await result.act(() => {
      window.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          pointerId: 1,
        }),
      )
    })

    assert.equal(card.dataset.endPosition, '27,33')
    assert.equal(card.dataset.endTargetIsCard, 'true')
  })
})
