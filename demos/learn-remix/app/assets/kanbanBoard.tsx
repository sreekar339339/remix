import { clientEntry, css, on } from 'remix/ui'
import { customEvents, evented } from './utils/customEvents/index.tsx'

type Card = {
  title: string
  urgent: boolean
}

type Column = {
  title: string
  cards: Map<string, Card>
}

const columnCss = css({
  minWidth: 240,
  padding: 12,
  borderRadius: 8,
  backgroundColor: '#f4f4f5',
  color: '#18181b',
  display: 'grid',
  alignContent: 'start',
  gap: 10,
})

const cardCss = css({
  padding: 12,
  border: '1px solid #d4d4d8',
  borderRadius: 6,
  backgroundColor: 'white',
  color: '#18181b',
  display: 'grid',
  gap: 8,
  "&[data-urgent='true']": {
    borderColor: '#dc2626',
    backgroundColor: '#fef2f2',
  },
})

const buttonCss = css({
  justifySelf: 'start',
  padding: '5px 8px',
  border: '1px solid #71717a',
  borderRadius: 4,
  backgroundColor: 'white',
  color: '#18181b',
  font: 'inherit',
  cursor: 'pointer',
})

function initialColumns() {
  return new Map<string, Column>([
    [
      'column:backlog',
      {
        title: 'Backlog',
        cards: new Map([
          [
            'card:design',
            {
              title: 'Review interaction design',
              urgent: false,
            },
          ],
          [
            'card:metrics',
            {
              title: 'Define success metrics',
              urgent: false,
            },
          ],
        ]),
      },
    ],
    [
      'column:building',
      {
        title: 'Building',
        cards: new Map([
          [
            'card:routing',
            {
              title: 'Prototype deep patch routing',
              urgent: true,
            },
          ],
        ]),
      },
    ],
  ])
}

export const KanbanBoard = clientEntry(import.meta.url, function KanbanBoard() {
  let { events, state } = customEvents().store({
    columns: initialColumns(),
  })
  let renderCounts = new Map<string, number>()

  function nextRenderCount(id: string) {
    let count = (renderCounts.get(id) ?? 0) + 1
    renderCounts.set(id, count)
    return count
  }

  return () => (
    <section
      mix={css({
        width: 'min(900px, 100%)',
        display: 'grid',
        gap: 16,
      })}
    >
      <header>
        <h1>Deep identity routing experiment</h1>
        <p>
          Toggle a card. Its deep Immer patch updates only that card and its owning column; render
          counters make the boundary visible.
        </p>
      </header>
      <div
        mix={css({
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 14,
          alignItems: 'start',
        })}
      >
        {state.value.columns
          .entries()
          .map(([columnId, column]) => (
            <section key={columnId} mix={columnCss}>
              <header>
                <h2>{column.title}</h2>
                <evented.output
                  eventSource={events.columns.get(columnId)}
                  aria-label={`${column.title} view`}
                >
                  {({ detail }) => {
                    if (!detail) return null
                    let urgent = detail.cards
                      .values()
                      .reduce((count, card) => count + Number(card.urgent), 0)
                    return `${urgent} urgent · rendered ${nextRenderCount(columnId)}`
                  }}
                </evented.output>
              </header>
              {column.cards
                .entries()
                .map(([cardId, initialCard]) => (
                  <evented.article
                    eventSource={events.columns.get(columnId).cards.get(cardId)}
                    key={cardId}
                    aria-label={initialCard.title}
                    data-urgent={({ detail }) => detail?.urgent}
                    mix={cardCss}
                  >
                    {({ detail }) => {
                      if (!detail) return null
                      return (
                        <>
                          <strong>{detail.title}</strong>
                          <span>
                            {`${detail.urgent ? 'Urgent' : 'Normal'} · rendered ${nextRenderCount(
                              cardId,
                            )}×`}
                          </span>
                          <button
                            type="button"
                            aria-label={`Toggle ${detail.title} urgency`}
                            mix={[
                              buttonCss,
                              on('click', () => {
                                state.update((draft) => {
                                  let card = draft.columns.get(columnId)?.cards.get(cardId)
                                  if (card) card.urgent = !card.urgent
                                })
                              }),
                            ]}
                          >
                            Toggle urgency
                          </button>
                        </>
                      )
                    }}
                  </evented.article>
                ))
                .toArray()}
            </section>
          ))
          .toArray()}
      </div>
    </section>
  )
})
