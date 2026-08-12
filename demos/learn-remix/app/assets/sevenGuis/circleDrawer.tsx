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

function nextDrawingSnapshot(circles: Map<number, Circle>, history: CircleHistory): CircleHistory {
  return {
    snapshots: [...history.snapshots.slice(0, history.index + 1), new Map(circles)],
    index: history.index + 1,
  }
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
        addCircle: (held, point: { x: number; y: number }) => {
          if (held.editingCircleById !== null) return {}
          if (hitCircle(held.circles.values(), point.x, point.y)) return {}
          let circle = {
            id: held.nextCircleId,
            ...point,
            diameter: 30,
          }
          let circles = new Map(held.circles).set(circle.id, circle)
          return {
            circles,
            history: nextDrawingSnapshot(circles, held.history),
            nextCircleId: held.nextCircleId + 1,
          }
        },
        openEditor: (held, id: number) => {
          if (held.editingCircleById !== null) return {}
          return { editingCircleById: id }
        },
        setDiameter: (held, diameter: number) => {
          let id = held.editingCircleById
          if (id === null) return {}
          let circle = held.circles.get(id)
          if (!circle || circle.diameter === diameter) return {}
          return { circles: new Map(held.circles).set(id, { ...circle, diameter }) }
        },
        closeEditor: (held) => {
          let id = held.editingCircleById
          if (id === null) return {}
          let circle = held.circles.get(id)
          let committed = held.history.snapshots[held.history.index]?.get(id)
          if (circle && committed && circle.diameter !== committed.diameter) {
            return {
              history: nextDrawingSnapshot(held.circles, held.history),
              editingCircleById: null,
            }
          }
          return { editingCircleById: null }
        },
        undo: (held) => {
          let index = held.history.index - 1
          if (index < 0) return {}
          return {
            circles: new Map(
              held.history.snapshots[index]!.entries().map(([id, circle]) => [id, { ...circle }]),
            ),
            editingCircleById: null,
            history: { ...held.history, index },
          }
        },
        redo: (held) => {
          let index = held.history.index + 1
          if (index >= held.history.snapshots.length) return {}
          return {
            circles: new Map(
              held.history.snapshots[index]!.entries().map(([id, circle]) => [id, { ...circle }]),
            ),
            editingCircleById: null,
            history: { ...held.history, index },
          }
        },
      },
    )

    return () => (
      <section mix={taskCss}>
        <h2>Circle Drawer</h2>
        <div mix={rowCss}>
          <evented.button
            eventSource={events.history}
            type="button"
            disabled={(history) => history.index === 0}
            mix={[
              buttonCss,
              on('click', () => {
                events.dispatch('undo')
              }),
            ]}
          >
            Undo
          </evented.button>
          <evented.button
            eventSource={events.history}
            type="button"
            disabled={(history) => history.index === history.snapshots.length - 1}
            mix={[
              buttonCss,
              on('click', () => {
                events.dispatch('redo')
              }),
            ]}
          >
            Redo
          </evented.button>
        </div>
        <svg
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
              events.dispatch({ addCircle: point })
            }),
          ]}
        >
          <evented.list eventSource={events.circles}>
            {(circle, id) => (
              <evented.circle
                eventSource={[events.circles.get(id).diameter, events.editingCircleById.as(id)]}
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
                    events.dispatch({ openEditor: id })
                  }),
                ]}
              />
            )}
          </evented.list>
        </svg>
        <evented.form
          eventSource={events.editingCircleById}
          hidden={(circleId) => circleId === null}
          mix={[
            rowCss,
            on('submit', (event) => {
              event.preventDefault()
              events.dispatch('closeEditor')
            }),
          ]}
        >
          <label>
            Diameter{' '}
            <evented.input
              eventSource={[events.editingCircleById, events.circles]}
              type="range"
              min={10}
              max={120}
              defaultValue={([editingId, circles]) => {
                return editingId === null ? 10 : (circles.get(editingId)?.diameter ?? 10)
              }}
              mix={[
                inputCss,
                on('input', ({ currentTarget }) => {
                  events.dispatch({ setDiameter: currentTarget.valueAsNumber })
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
