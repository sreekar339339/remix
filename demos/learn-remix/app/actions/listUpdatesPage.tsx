import { css } from 'remix/ui'
import { Layout } from '../ui/layout.tsx'
import {
  ListUpdatesFeedBoard,
  ListUpdatesFilterBoard,
  ListUpdatesHeavyBoard,
} from '../assets/listUpdates/listUpdatesBoard.tsx'

export function ListUpdatesPage() {
  return () => (
    <Layout>
      <section
        mix={css({
          display: 'grid',
          gap: 18,
          width: 'min(980px, 100%)',
          paddingBottom: 48,
        })}
      >
        <header>
          <h1>Fine-grained list updates vs re-render</h1>
          <p>
            Three workloads where evented list updates beat a plain re-render. Every section has an
            evented/plain toggle and a DOM-mutation meter; the meter only sees DOM work, so also
            open the performance panel to watch the template execution that the plain re-render pays
            for on every update.
          </p>
        </header>
        <ListUpdatesFilterBoard />
        <ListUpdatesFeedBoard />
        <ListUpdatesHeavyBoard />
      </section>
    </Layout>
  )
}
