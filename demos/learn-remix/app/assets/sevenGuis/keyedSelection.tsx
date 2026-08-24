import { clientEntry, css, on } from 'remix/ui'
import { Events, evented } from '../utils/customEvents/index.tsx'
import { buttonCss, rowCss, taskCss } from './styles.ts'

const items = [
  { id: 'alpha', label: 'Alpha' },
  { id: 'bravo', label: 'Bravo' },
  { id: 'charlie', label: 'Charlie' },
]

class KeyedSelectionEvents extends Events {
  selectedId = items[0]!.id
}

export const KeyedSelection = clientEntry(import.meta.url, function KeyedSelection() {
  let events = KeyedSelectionEvents.define()

  let renderCounts = new Map<string, number>()

  return () => (
    <section mix={taskCss}>
      <h2>Keyed selection</h2>
      <p>
        Selecting an item changes its identity, so only the losing and gaining option re-render.
      </p>
      <div mix={rowCss}>
        {items.map((item) => (
          <evented.button
            on={events.on.selectedId.as(item.id)}
            key={item.id}
            aria-label={item.label}
            type="button"
            aria-pressed={(selected) => selected}
            data-renders={() => {
              let count = (renderCounts.get(item.id) ?? 0) + 1
              renderCounts.set(item.id, count)
              return count
            }}
            mix={[
              buttonCss,
              css({
                "&[aria-pressed='true']": {
                  color: 'white',
                  backgroundColor: '#2563eb',
                },
              }),
              on('click', () => {
                events.dispatchEvent({ selectedId: item.id })
              }),
            ]}
          >
            {item.label}
          </evented.button>
        ))}
      </div>
      <p>
        Selected:{' '}
        <evented.output on={events.on.selectedId}>
          {(selectedId) => selectedId ?? ''}
        </evented.output>
      </p>
    </section>
  )
})
