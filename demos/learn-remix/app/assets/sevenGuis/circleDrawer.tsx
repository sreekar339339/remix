import { clientEntry, css, on } from 'remix/ui'
import { customEvents, evented } from '../utils/customEvents/index.tsx'
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

export const SevenGuisCircleDrawer = clientEntry(
  import.meta.url,
  function SevenGuisCircleDrawer(handle) {
    let events = customEvents(
      {
        circles: new Map<number, Circle>(),
        editingCircleById: null as number | null,
        history: { snapshots: [new Map<number, Circle>()], index: 0 },
        nextCircleId: 1,
      },
      {
        addCircle: (point: { x: number; y: number }, detail) => {
          if (detail.editingCircleById !== null) return
          if (hitCircle(detail.circles.values(), point.x, point.y)) return
          let circle = {
            id: detail.nextCircleId,
            ...point,
            diameter: 30,
          }
          detail.circles.set(circle.id, circle)
          recordDrawingSnapshot(detail.circles, detail.history)
          detail.nextCircleId += 1
        },
        openEditor: (id: number, detail) => {
          if (detail.editingCircleById !== null) return
          detail.editingCircleById = id
        },
        setDiameter: (diameter: number, detail) => {
          let id = detail.editingCircleById
          if (id === null) return
          let circle = detail.circles.get(id)
          if (!circle || circle.diameter === diameter) return
          circle.diameter = diameter
        },
        closeEditor: (_detail, detail) => {
          let id = detail.editingCircleById
          if (id === null) return
          let circle = detail.circles.get(id)
          let committed = detail.history.snapshots[detail.history.index]?.get(id)
          if (circle && committed && circle.diameter !== committed.diameter) {
            recordDrawingSnapshot(detail.circles, detail.history)
          }
          detail.editingCircleById = null
        },
        undo: (_detail, detail) => {
          let index = detail.history.index - 1
          if (index < 0) return
          detail.circles = new Map(
            detail.history.snapshots[index]!.entries().map(([id, circle]) => [id, { ...circle }]),
          )
          detail.editingCircleById = null
          detail.history.index = index
        },
        redo: (_detail, detail) => {
          let index = detail.history.index + 1
          if (index >= detail.history.snapshots.length) return
          detail.circles = new Map(
            detail.history.snapshots[index]!.entries().map(([id, circle]) => [id, { ...circle }]),
          )
          detail.editingCircleById = null
          detail.history.index = index
        },
      },
    )
    return () => (
      <section mix={taskCss}>
        <h2>Circle Drawer</h2>
        <div mix={rowCss}>
          <evented.button
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
          </evented.button>
          <evented.button
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
          </evented.button>
        </div>
        <evented.svg
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
                <evented.circle
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
        </evented.svg>
        <evented.form
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
            <evented.input
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
        </evented.form>
      </section>
    )
  },
)
