import { createMixin, on } from 'remix/ui'
import { Events } from './utils/customEvents/index.tsx'

type DraggableCustomEventDetail = {
  left: number
  top: number
}

class DraggableEvents extends Events {
  start(detail: DraggableCustomEventDetail) {}
  end(detail: DraggableCustomEventDetail) {}
}

const events = DraggableEvents.define()

type DraggableCustomEventsProps = {
  on?: Record<string, (event: Event) => void>
}

function readPx(value: string) {
  let parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export const draggable_ = createMixin<HTMLElement, [boolean], DraggableCustomEventsProps>(
  (handle) => {
    let element: HTMLElement | undefined
    let enabled = true
    let pointerId: number | undefined
    let startLeft = 0
    let startTop = 0
    let startClientX = 0
    let startClientY = 0

    handle.addEventListener('insert', (event) => {
      element = event.node
    })

    handle.addEventListener('remove', () => stopDrag())

    function startDrag(event: PointerEvent) {
      if (!enabled || !element || event.button !== 0) return

      let style = getComputedStyle(element)
      if (style.position === 'static') {
        element.style.position = 'relative'
      }

      startLeft = readPx(element.style.left)
      startTop = readPx(element.style.top)
      startClientX = event.clientX
      startClientY = event.clientY
      pointerId = event.pointerId
      element.setPointerCapture(event.pointerId)
      element.dispatchEvent(events.create({ start: { left: startLeft, top: startTop } }))
      window.addEventListener('pointermove', moveDrag)
      window.addEventListener('pointerup', stopDrag)
      window.addEventListener('pointercancel', stopDrag)
    }

    function moveDrag(event: PointerEvent) {
      if (!element || event.pointerId !== pointerId) return
      element.style.left = `${startLeft + event.clientX - startClientX}px`
      element.style.top = `${startTop + event.clientY - startClientY}px`
    }

    function stopDrag(event?: PointerEvent) {
      if (!element || pointerId === undefined) return
      if (event && event.pointerId !== pointerId) return

      pointerId = undefined
      window.removeEventListener('pointermove', moveDrag)
      window.removeEventListener('pointerup', stopDrag)
      window.removeEventListener('pointercancel', stopDrag)
      element.dispatchEvent(
        events.create({
          end: {
            left: readPx(element.style.left),
            top: readPx(element.style.top),
          },
        }),
      )
    }

    return (nextEnabled = true, props) => {
      enabled = nextEnabled
      if (!enabled) stopDrag()
      return <handle.element {...props} mix={on('pointerdown', (event) => startDrag(event))} />
    }
  },
)

export const draggable = Object.assign(draggable_, { events })

function DraggableCard() {
  return () => (
    <div
      mix={[
        draggable(true),
        draggable.events.on.start(({ detail: { left, top } }) => {
          console.log('draggable start with:', { left }, { top })
        }),
        draggable.events.on.end(({ detail: { left, top } }) => {
          console.log('draggable end with:', { left }, { top })
        }),
      ]}
    />
  )
}
