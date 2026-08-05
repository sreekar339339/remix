import { KanbanBoard } from '../assets/kanbanBoard.tsx'
import { Layout } from '../ui/layout.tsx'

export function KanbanPage() {
  return () => (
    <Layout>
      <KanbanBoard />
    </Layout>
  )
}
