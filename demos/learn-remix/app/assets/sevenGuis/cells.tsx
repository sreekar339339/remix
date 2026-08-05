import { clientEntry, css, on } from 'remix/ui'
import { customEvents } from '../utils/customEvents/index.tsx'
import { taskCss } from './styles.ts'

const columns = ['A', 'B', 'C', 'D', 'E', 'F'] as const
const rows = Array.from({ length: 12 }, (_, index) => index)
type CellId = `${(typeof columns)[number]}${number}`
type Values = Partial<Record<CellId, string>>

function cellId(column: (typeof columns)[number], row: number): CellId {
  return `${column}${row}`
}

function adjacentCellId(
  column: (typeof columns)[number],
  row: number,
  key: string,
): CellId | undefined {
  let columnIndex = columns.indexOf(column)
  let nextColumn = columnIndex
  let nextRow = row

  if (key === 'ArrowLeft') nextColumn--
  else if (key === 'ArrowRight') nextColumn++
  else if (key === 'ArrowUp') nextRow--
  else if (key === 'ArrowDown') nextRow++
  else return

  let columnAtIndex = columns[nextColumn]
  if (columnAtIndex === undefined || !rows.includes(nextRow)) return
  return cellId(columnAtIndex, nextRow)
}

function isCellNavigationShortcut(event: KeyboardEvent): boolean {
  let isMacOS = navigator.platform.startsWith('Mac')
  return event.shiftKey && (isMacOS ? event.metaKey : event.ctrlKey)
}

function evaluate(formula: string | undefined, values: Values): string {
  if (!formula) return ''
  if (!formula.startsWith('=')) return formula
  let expression = formula
    .slice(1)
    .replace(/\b[A-F](?:[0-9]|1[01])\b/g, (reference) =>
      String(Number(values[reference as CellId] ?? 0)),
    )
  if (!/^[\d+\-*/().\s]+$/.test(expression)) return '#ERR'
  try {
    let result = Function(`"use strict"; return (${expression})`)()
    return Number.isFinite(result) ? String(result) : '#ERR'
  } catch {
    return '#ERR'
  }
}

function calculate(formulas: Values): Values {
  let values: Values = {}
  for (let pass = 0; pass < 8; pass++) {
    for (let row of rows) {
      for (let column of columns) {
        let id = cellId(column, row)
        values[id] = evaluate(formulas[id], values)
      }
    }
  }
  return values
}

let cellCss = css({
  width: '100%',
  padding: '4px 6px',
  textAlign: 'right',
  border: '1px solid transparent',
  borderRadius: 0,
  background: 'transparent',
  font: 'inherit',
  boxSizing: 'border-box',
})

export const SevenGuisCells = clientEntry(import.meta.url, function SevenGuisCells() {
  let formulas: Values = { A0: '10', B0: '20', C0: '=A0+B0' }
  let renderCounts = new Map<CellId, number>()
  let { view, events, state } = customEvents<{ cellDrafted: string }>().store({
    values: calculate(formulas),
    focusTarget: cellId('A', 0),
  })
  return () => (
    <section mix={[taskCss]}>
      <h2>Cells</h2>
      <div
        mix={css({
          overflow: 'auto',
          maxHeight: 360,
          border: '1px solid #d4d4d8',
        })}
      >
        <table
          mix={css({
            borderCollapse: 'collapse',
            minWidth: 620,
            '& th, & td': { border: '1px solid #e4e4e7', padding: 0 },
            '& th': { padding: '4px 6px' },
          })}
        >
          <thead>
            <tr>
              <th />
              {columns.map((column) => (
                <th>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr>
                <th>{row}</th>
                {columns.map((column, __, _, id = cellId(column, row)) => (
                  <td key={id}>
                    <view.input
                      on={[events.values[id], events.cellDrafted]}
                      aria-label={id}
                      data-render-count={() => {
                        let count = (renderCounts.get(id) ?? 0) + 1
                        renderCounts.set(id, count)
                        return String(count)
                      }}
                      type="text"
                      defaultValue={({ detail: [committed, draft] }) => draft ?? committed}
                      value={({ detail: [committed, draft] }) => draft ?? committed}
                      mix={[
                        cellCss,
                        events.focusTarget.as(id).on(({ currentTarget }) => {
                          currentTarget.focus()
                        }),
                        on('blur', ({ currentTarget }) => {
                          formulas[id] = currentTarget.value
                          let values = calculate(formulas)
                          let previousValue: string | undefined
                          state.update((draft) => {
                            previousValue = draft.values[id]
                            Object.assign(draft.values, values)
                          })
                          if (Object.is(previousValue, values[id])) {
                            currentTarget.dispatchEvent(
                              events.create('cellDrafted', values[id] ?? ''),
                            )
                          }
                        }),
                        on('focus', ({ currentTarget }) => {
                          currentTarget.dispatchEvent(
                            events.create('cellDrafted', formulas[id] ?? ''),
                          )
                          currentTarget.select()
                        }),
                        on('input', ({ currentTarget }) => {
                          currentTarget.dispatchEvent(
                            events.create('cellDrafted', currentTarget.value),
                          )
                        }),
                        on('keydown', (event) => {
                          if (!isCellNavigationShortcut(event)) return
                          let nextId = adjacentCellId(column, row, event.key)
                          if (nextId === undefined) return
                          event.preventDefault()
                          state.update((draft) => {
                            draft.focusTarget = nextId
                          })
                        }),
                      ]}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
})
