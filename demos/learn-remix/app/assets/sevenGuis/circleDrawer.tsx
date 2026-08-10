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

type DrawingModel = {
  circles: Map<number, Circle>
  editingCircleById: number | null
  history: CircleHistory
}

function recordDrawingSnapshot(circles: Map<number, Circle>, history: CircleHistory) {
  history.snapshots.splice(history.index + 1)
  history.snapshots.push(new Map(circles.entries().map(([id, circle]) => [id, { ...circle }])))
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
    let { events, state } = customEvents<DrawingModel>().store({
      circles: new Map(),
      editingCircleById: null,
      history: { snapshots: [new Map()], index: 0 },
    })
    let nextCircleId = 1
    function closeDiameterEditor() {
      state.update((draft) => {
        let id = draft.editingCircleById
        if (id === null) return
        let circle = draft.circles.get(id)
        let committedCircle = draft.history.snapshots[draft.history.index]?.get(id)
        if (circle?.diameter !== committedCircle?.diameter) {
          recordDrawingSnapshot(draft.circles, draft.history)
        }
        draft.editingCircleById = null
      })
    }

    function travel(direction: -1 | 1) {
      state.update((draft) => {
        let index = draft.history.index + direction
        if (index < 0 || index >= draft.history.snapshots.length) return
        draft.circles = new Map(
          draft.history.snapshots[index]!.entries().map(([id, circle]) => [id, { ...circle }]),
        )
        draft.editingCircleById = null
        draft.history.index = index
      })
    }

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
                travel(-1)
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
                travel(1)
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
              state.update((draft) => {
                if (draft.editingCircleById !== null) return
                if (hitCircle(draft.circles.values(), point.x, point.y)) return
                let circle = {
                  id: nextCircleId++,
                  ...point,
                  diameter: 30,
                }
                draft.circles.set(circle.id, circle)
                recordDrawingSnapshot(draft.circles, draft.history)
              })
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
                    state.update((draft) => {
                      if (draft.editingCircleById !== null) return
                      draft.editingCircleById = id
                    })
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
              closeDiameterEditor()
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
                  let diameter = currentTarget.valueAsNumber
                  state.update((draft) => {
                    let id = draft.editingCircleById
                    if (id === null) return
                    let circle = draft.circles.get(id)
                    if (!circle || circle.diameter === diameter) return
                    circle.diameter = diameter
                  })
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
