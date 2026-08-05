import { Layout } from '../ui/layout.tsx'
import { TodoList } from '../assets/todolist/todoList.tsx'
import type { Handle } from 'remix/ui'
import type { Todo } from '../data/todolist.ts'

export function TodoListCustomEventsPage(handle: Handle<{ todos: Todo[] }>) {
  return () => (
    <Layout>
      <h1>Todo-list custom events</h1>
      <TodoList todos={handle.props.todos} />
    </Layout>
  )
}
