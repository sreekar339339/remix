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

export const SevenGuisCircleDrawer = clientEntry(import.meta.url, function SevenGuisCircleDrawer() {
  let root = {
    circles: new Map<number, Circle>(),
    editingCircleById: null as number | null,
    history: { snapshots: [new Map<number, Circle>()], index: 0 },
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
      recordDrawingSnapshot(draft.circles, draft.history)
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
      let id = draft.editingCircleById
      if (id === null) return
      let circle = draft.circles.get(id)
      let committed = draft.history.snapshots[draft.history.index]?.get(id)
      if (circle && committed && circle.diameter !== committed.diameter) {
        recordDrawingSnapshot(draft.circles, draft.history)
      }
      draft.editingCircleById = null
    },
  })

  // Restores a recorded drawing through the patch channel: the circles
  // slice, the history cursor, and the closed editor in one batch.
  function restoreSnapshot(snapshot: Map<number, Circle>, index: number) {
    let patches: CustomEventsPatch[] = [
      {
        op: 'replace',
        path: ['circles'],
        value: new Map(snapshot.entries().map(([id, circle]) => [id, { ...circle }])),
      },
      { op: 'replace', path: ['history'], value: { ...root.history, index } },
      { op: 'replace', path: ['editingCircleById'], value: null },
    ]
    events.applyPatches(patches)
  }

  return () => (
    <section mix={taskCss}>
      <h2>Circle Drawer</h2>
      <div mix={rowCss}>
        <evented.button
          eventSource={events.on.history}
          type="button"
          disabled={(history) => history.index === 0}
          mix={[
            buttonCss,
            on('click', () => {
              let snapshot = root.history.snapshots[root.history.index - 1]
              if (snapshot) restoreSnapshot(snapshot, root.history.index - 1)
            }),
          ]}
        >
          Undo
        </evented.button>
        <evented.button
          eventSource={events.on.history}
          type="button"
          disabled={(history) => history.index === history.snapshots.length - 1}
          mix={[
            buttonCss,
            on('click', () => {
              let snapshot = root.history.snapshots[root.history.index + 1]
              if (snapshot) restoreSnapshot(snapshot, root.history.index + 1)
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
            events.dispatchEvent({ addCircle: point })
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
})
