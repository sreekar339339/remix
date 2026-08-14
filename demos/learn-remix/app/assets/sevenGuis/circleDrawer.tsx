import { clientEntry, css, on } from 'remix/ui'
import { customEvents, evented } from '../utils/customEvents/index.tsx'
import type { CustomEventsPatch } from '../utils/customEvents/runtime.ts'
import { buttonCss, inputCss, rowCss, taskCss } from './styles.ts'

type Circle = {
  id: number
  x: number
  y: number
  diameter: number
}

type Drawing = {
  /** The circles before the change, for inverse patches. */
  previous: Map<number, Circle>
  /** The canonical patches of the change, for replay. */
  patches: readonly CustomEventsPatch[]
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

function readAt(value: unknown, path: readonly unknown[]) {
  let current = value
  for (let index = 1; index < path.length; index++) {
    if (current instanceof Map) {
      current = current.get(Number(path[index]))
    } else if (current !== null && typeof current === 'object') {
      current = Reflect.get(current, path[index] as PropertyKey)
    } else {
      return undefined
    }
  }
  return current
}

/** The inverse of a drawing's patches against its pre-change circles. */
function undoPatches(drawing: Drawing): CustomEventsPatch[] {
  return drawing.patches.flatMap((patch): CustomEventsPatch[] => {
    if (patch.path[0] !== 'circles' || patch.op === 'remove') return []
    let previousValue = readAt(drawing.previous, patch.path)
    return previousValue === undefined
      ? [{ op: 'remove', path: patch.path }]
      : [{ op: 'replace', path: patch.path, value: previousValue }]
  })
}

export const SevenGuisCircleDrawer = clientEntry(
  import.meta.url,
  function SevenGuisCircleDrawer(handle) {
    let root = {
      circles: new Map<number, Circle>(),
      editingCircleById: null as number | null,
      nextCircleId: 1,
    }
    let events = customEvents({
      root,
      addCircle: (point: { x: number; y: number }, draft) => {
        if (draft.editingCircleById !== null) return
        if (hitCircle(draft.circles.values(), point.x, point.y)) return
        let circle = {
          id: draft.nextCircleId,
          ...point,
          diameter: 30,
        }
        draft.circles.set(circle.id, circle)
        draft.nextCircleId += 1
      },
      openEditor: (id: number, draft) => {
        if (draft.editingCircleById !== null) return
        draft.editingCircleById = id
      },
      setDiameter: (diameter: number, draft) => {
        let id = draft.editingCircleById
        if (id === null) return
        let circle = draft.circles.get(id)
        if (!circle || circle.diameter === diameter) return
        circle.diameter = diameter
      },
      closeEditor: (_detail, draft) => {
        draft.editingCircleById = null
      },
    })

    let history: Drawing[] = []
    let historyIndex = -1
    let pending: readonly CustomEventsPatch[] = []
    events.onPatch((patches) => {
      pending = patches
    })

    // The change point of a drawing: captures the circles before a mutating
    // dispatch and records the patches the dispatch streamed.
    function recordDrawing(previous: Map<number, Circle>) {
      if (pending.length === 0) return
      history.splice(historyIndex + 1)
      history.push({ previous, patches: pending })
      historyIndex++
      handle.update()
    }

    let editorPrevious: Map<number, Circle> | undefined

    return () => (
      <section mix={taskCss}>
        <h2>Circle Drawer</h2>
        <div mix={rowCss}>
          <button
            type="button"
            disabled={historyIndex < 0}
            mix={[
              buttonCss,
              on('click', async () => {
                if (historyIndex < 0) return
                let drawing = history[historyIndex]!
                historyIndex--
                editorPrevious = undefined
                await events.applyPatches(undoPatches(drawing))
                events.dispatchEvent('closeEditor')
                handle.update()
              }),
            ]}
          >
            Undo
          </button>
          <button
            type="button"
            disabled={historyIndex === history.length - 1}
            mix={[
              buttonCss,
              on('click', async () => {
                let drawing = history[historyIndex + 1]!
                historyIndex++
                editorPrevious = undefined
                await events.applyPatches(drawing.patches)
                events.dispatchEvent('closeEditor')
                handle.update()
              }),
            ]}
          >
            Redo
          </button>
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
              let previous = new Map(root.circles)
              pending = []
              events.dispatchEvent({ addCircle: point })
              recordDrawing(previous)
            }),
          ]}
        >
          <evented.svg eventSource={events.on.circles}>
            {(circles) => (
              <>
                {[...circles.entries()].map(([id, circle]) => (
                  <evented.circle
                    key={id}
                    eventSource={[
                      events.on.circles.get(id).diameter,
                      events.on.editingCircleById.as(id),
                    ]}
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
                        editorPrevious = new Map(root.circles)
                        pending = []
                        events.dispatchEvent({ openEditor: id })
                      }),
                    ]}
                  />
                ))}
              </>
            )}
          </evented.svg>
        </svg>
        <evented.form
          eventSource={events.on.editingCircleById}
          hidden={(circleId) => circleId === null}
          mix={[
            rowCss,
            on('submit', (event) => {
              event.preventDefault()
              if (editorPrevious !== undefined) {
                recordDrawing(editorPrevious)
                editorPrevious = undefined
              }
              events.dispatchEvent('closeEditor')
            }),
          ]}
        >
          <label>
            Diameter{' '}
            <evented.input
              eventSource={[events.on.editingCircleById, events.on.circles]}
              type="range"
              min={10}
              max={120}
              defaultValue={([editingId, circles]) =>
                editingId === null ? 10 : (circles.get(editingId)?.diameter ?? 10)
              }
              mix={[
                inputCss,
                on('input', ({ currentTarget }) => {
                  pending = []
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
