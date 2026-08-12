import { clientEntry, css, on, ref } from 'remix/ui'
import { customEvents, evented } from './utils/customEvents/index.tsx'

type Player = 'X' | 'O'
type Result = Player | 'Draw'

const winningCombos = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
]

function deriveResult(position: Map<number, Player>): Result | null {
  for (let [a, b, c] of winningCombos) {
    if (
      position.has(a) &&
      position.get(a) === position.get(b) &&
      position.get(a) === position.get(c)
    ) {
      return position.get(a)!
    }
  }
  return position.size === 9 ? 'Draw' : null
}

const arrowKeyIdxIncrementMap = {
  ArrowUp: -3,
  ArrowDown: 3,
  ArrowLeft: -1,
  ArrowRight: 1,
}

const isArrowKey = (eventKey: unknown): eventKey is keyof typeof arrowKeyIdxIncrementMap =>
  Object.hasOwn(arrowKeyIdxIncrementMap, eventKey as string)

export const TicTacToeCustomEvents = clientEntry(import.meta.url, function TicTacToeCustomEvents() {
  let events = customEvents(
    {
      position: new Map<number, Player>(),
      result: null as Result | null,
      focusTarget: NaN,
    },
    {
      place: (draft, cellId: number) => {
        if (draft.position.has(cellId) || draft.result !== null) return
        let nextPlayer: Player = draft.position.size % 2 === 0 ? 'X' : 'O'
        draft.position.set(cellId, nextPlayer)
        let result = deriveResult(draft.position)
        draft.result = result
        if (result === null) {
          let nextFreeCellIdx = cellId
          while (draft.position.has(nextFreeCellIdx)) {
            nextFreeCellIdx = (nextFreeCellIdx + 1) % 9
            if (nextFreeCellIdx === cellId) break
          }
          draft.focusTarget = nextFreeCellIdx
        }
      },
      moveFocus: (draft, { cellId, increment }: { cellId: number; increment: number }) => {
        let boundIdx = increment < 0 ? 0 : 8
        let nextFreeCellIdx = cellId
        while (nextFreeCellIdx === cellId || draft.position.has(nextFreeCellIdx)) {
          nextFreeCellIdx += increment
          if (
            (boundIdx === 0 && nextFreeCellIdx < boundIdx) ||
            (boundIdx === 8 && nextFreeCellIdx > boundIdx)
          ) {
            break
          }
        }
        draft.focusTarget = nextFreeCellIdx
      },
      reset: (draft) => {
        draft.position.clear()
        draft.result = null
        draft.focusTarget = 0
      },
    },
  )

  return () => (
    <div
      mix={css({
        display: 'grid',
        gap: 16,
        maxWidth: 360,
      })}
    >
      <div
        mix={[
          css({
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 4,
          }),
          on('click', ({ target }) => {
            if (!(target instanceof HTMLElement)) return
            let cellId = Number(target.dataset.idx)
            events.dispatchEvent({ place: cellId })
          }),
          on('keydown', ({ key, target }) => {
            if (!isArrowKey(key)) return
            if (!(target instanceof HTMLElement)) return
            let cellId = Number(target.dataset.idx)
            events.dispatchEvent({
              moveFocus: { cellId, increment: arrowKeyIdxIncrementMap[key] },
            })
          }),
        ]}
      >
        {Array.from({ length: 9 }, (_, index) => (
          <evented.button
            eventSource={[events.on.position.get(index), events.on.result]}
            key={index}
            data-idx={String(index)}
            aria-label={`Cell ${index}`}
            disabled={([pos, result]) => pos !== undefined || result !== null}
            class={([pos]) => pos}
            mix={[
              css({
                aspectRatio: '1/1',
                fontSize: 32,
                fontWeight: 'bold',
                '&.X': {
                  color: 'blue',
                },
                '&.O': {
                  color: 'red',
                },
              }),
              events.on.focusTarget.as(index)(({ currentTarget }) => {
                currentTarget.focus()
              }),
            ]}
          >
            {([pos]) => pos}
          </evented.button>
        ))}
      </div>
      <button
        mix={[
          css({ fontSize: '18px', padding: '8px 16px' }),
          events.on.result(({ currentTarget, detail }) => {
            if (detail === null) return
            currentTarget.focus()
          }),
          on('click', () => {
            events.dispatchEvent('reset')
          }),
          ref(() => {
            events.dispatchEvent({ focusTarget: 0 })
          }),
        ]}
      >
        Reset
      </button>
      <p
        mix={[
          css({
            fontSize: 18,
            textAlign: 'center',
          }),
        ]}
      >
        <evented.span eventSource={events.on.result}>
          {(result) => {
            if (!result) return 'Game in progress'
            if (result === 'Draw') return 'Game is drawn.'
            return `${result} has won!`
          }}
        </evented.span>
      </p>
    </div>
  )
})
