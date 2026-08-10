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
  let { events, state } = customEvents().store({
    position: new Map<number, Player>(),
    result: null as Result | null,
    focusTarget: NaN,
  })
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
            if (Number.isNaN(cellId)) return
            if (cellId < 0) return
            state.update((draft) => {
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
            })
          }),
          on('keydown', ({ key, target }) => {
            if (!isArrowKey(key)) return
            if (!(target instanceof HTMLElement)) return
            let cellId = Number(target.dataset.idx)
            if (Number.isNaN(cellId)) return
            if (cellId < 0) return
            let idxIncrement = arrowKeyIdxIncrementMap[key]
            let boundIdx = idxIncrement < 0 ? 0 : 8
            state.update((draft) => {
              let nextFreeCellIdx = cellId
              while (nextFreeCellIdx === cellId || draft.position.has(nextFreeCellIdx)) {
                nextFreeCellIdx += idxIncrement
                if (
                  (boundIdx === 0 && nextFreeCellIdx < boundIdx) ||
                  (boundIdx === 8 && nextFreeCellIdx > boundIdx)
                ) {
                  break
                }
              }
              draft.focusTarget = nextFreeCellIdx
            })
          }),
        ]}
      >
        {Array.from({ length: 9 }, (_, index) => (
          <evented.button
            eventSource={[events.position.get(index), events.result]}
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
              events.focusTarget.as(index).on(({ currentTarget }) => {
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
          events.result.on(({ currentTarget, detail }) => {
            if (detail === null) return
            currentTarget.focus()
          }),
          on('click', () => {
            state.update((draft) => {
              draft.position.clear()
              draft.result = null
              draft.focusTarget = 0
            })
          }),
          ref(() =>
            state.update((draft) => {
              draft.focusTarget = 0
            }),
          ),
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
        <evented.span eventSource={events.result}>
          {(detail) => {
            if (!detail) return 'Game in progress'
            if (detail === 'Draw') return 'Game is drawn.'
            return `${detail} has won!`
          }}
        </evented.span>
      </p>
    </div>
  )
})
