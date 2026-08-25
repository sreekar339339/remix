import { clientEntry, css, on } from 'remix/ui'
import { Events, evented as e } from '../utils/customEvents/index.tsx'
import { buttonCss, inputCss, rowCss, taskCss } from './styles.ts'

type Circle = {
  id: number
  x: number
  y: number
  diameter: number
}

type CircleHistory = {
  snapshots: Array<Map<number, Circle>>
  index: number
}

function recordDrawingSnapshot(circles: Map<number, Circle>, history: CircleHistory) {
  history.snapshots.splice(history.index + 1)
  history.snapshots.push(new Map(circles))
  history.index++
}

function hitCircle(circles: Iterable<Circle>, x: number, y: number) {
  return (
    Iterator.from(circles)
      .map((circle) => ({
        circle,
        distance: Math.hypot(circle.x - x, circle.y - y),
      }))
      .filter(({ circle, distance }) => distance <= circle.diameter / 2)
      .reduce(
        (nearest, candidate) =>
          nearest === null || candidate.distance < nearest.distance ? candidate : nearest,
        null as { circle: Circle; distance: number } | null,
      )?.circle ?? null
  )
}

function getCanvasPoint(canvas: SVGSVGElement, clientX: number, clientY: number) {
  let rect = canvas.getBoundingClientRect()
  if (!rect.width || !rect.height) return undefined
  return {
    x: ((clientX - rect.left) / rect.width) * 420,
    y: ((clientY - rect.top) / rect.height) * 220,
  }
}

class CircleDrawerEvents extends Events {
  circles = new Map<number, Circle>()
  editingCircleById = null as number | null
  history = { snapshots: [new Map<number, Circle>()], index: 0 }
  nextCircleId = 1
  addCircle(point: { x: number; y: number }) {
    if (this.editingCircleById !== null) return
    if (hitCircle(this.circles.values(), point.x, point.y)) return
    let circle = {
      id: this.nextCircleId,
      ...point,
      diameter: 30,
    }
    this.circles.set(circle.id, circle)
    recordDrawingSnapshot(this.circles, this.history)
    this.nextCircleId += 1
  }
  openEditor(id: number) {
    if (this.editingCircleById !== null) return
    this.editingCircleById = id
  }
  setDiameter(diameter: number) {
    let id = this.editingCircleById
    if (id === null) return
    let circle = this.circles.get(id)
    if (!circle || circle.diameter === diameter) return
    circle.diameter = diameter
  }
  closeEditor() {
    let id = this.editingCircleById
    if (id === null) return
    let circle = this.circles.get(id)
    let committed = this.history.snapshots[this.history.index]?.get(id)
    if (circle && committed && circle.diameter !== committed.diameter) {
      recordDrawingSnapshot(this.circles, this.history)
    }
    this.editingCircleById = null
  }
  undo() {
    let index = this.history.index - 1
    if (index < 0) return
    this.circles = new Map(
      this.history.snapshots[index]!.entries().map(([id, circle]: [number, Circle]) => [
        id,
        { ...circle },
      ]),
    )
    this.editingCircleById = null
    this.history.index = index
  }
  redo() {
    let index = this.history.index + 1
    if (index >= this.history.snapshots.length) return
    this.circles = new Map(
      this.history.snapshots[index]!.entries().map(([id, circle]: [number, Circle]) => [
        id,
        { ...circle },
      ]),
    )
    this.editingCircleById = null
    this.history.index = index
  }
}

export const SevenGuisCircleDrawer = clientEntry(
  import.meta.url,
  function SevenGuisCircleDrawer(handle) {

    let events = CircleDrawerEvents.define()
    return () => (
      <section mix={taskCss}>
        <h2>Circle Drawer</h2>
        <div mix={rowCss}>
          <e.button
            on={events.on.history}
            type="button"
            disabled={(history) => history.index === 0}
            mix={[
              buttonCss,
              on('click', () => {
                events.dispatchEvent('undo')
              }),
            ]}
          >
            Undo
          </e.button>
          <e.button
            on={events.on.history}
            type="button"
            disabled={(history) => history.index === history.snapshots.length - 1}
            mix={[
              buttonCss,
              on('click', () => {
                events.dispatchEvent('redo')
              }),
            ]}
          >
            Redo
          </e.button>
        </div>
        <e.svg
          on={events.on.circles}
          viewBox="0 0 420 220"
          aria-label="Circle canvas"
          mix={[
            css({
              width: '100%',
              height: 220,
              border: '1px solid #a1a1aa',
              backgroundColor: 'white',
            }),
            on('click', ({ currentTarget, clientX, clientY }) => {
              let point = getCanvasPoint(currentTarget, clientX, clientY)
              if (!point) return
              events.dispatchEvent({ addCircle: point })
            }),
          ]}
        >
          {(circles) => (
            <>
              {Array.from(circles.entries(), ([id, circle]) => (
                <e.circle
                  key={id}
                  on={[events.on.circles.get(id).diameter, events.on.editingCircleById.as(id)]}
                  cx={circle.x}
                  cy={circle.y}
                  r={([diameter]) => (diameter ?? circle.diameter) / 2}
                  fill={([, isEditing]) => (isEditing ? '#d4d4d8' : 'none')}
                  mix={[
                    css({
                      pointerEvents: 'all',
                      '&:hover': {
                        fill: '#d4d4d8',
                      },
                      stroke: '#18181b',
                    }),
                    on('contextmenu', (event) => {
                      event.preventDefault()
                      events.dispatchEvent({ openEditor: id })
                    }),
                  ]}
                />
              ))}
            </>
          )}
        </e.svg>
        <e.form
          on={events.on.editingCircleById}
          hidden={(circleId) => circleId === null}
          mix={[
            rowCss,
            on('submit', (event) => {
              event.preventDefault()
              events.dispatchEvent('closeEditor')
            }),
          ]}
        >
          <label>
            Diameter{' '}
            <e.input
              on={[events.on.editingCircleById, events.on.circles]}
              type="range"
              min={10}
              max={120}
              defaultValue={([editingId, circles]) =>
                editingId === null ? 10 : (circles.get(editingId)?.diameter ?? 10)
              }
              mix={[
                inputCss,
                on('input', ({ currentTarget }) => {
                  events.dispatchEvent({ setDiameter: currentTarget.valueAsNumber })
                }),
              ]}
            />
          </label>
          <button type="submit" mix={buttonCss}>
            Close
          </button>
        </e.form>
      </section>
    )
  },
)
