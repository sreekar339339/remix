import { clientEntry, css, Frame, type Handle } from 'remix/ui'
import { AddTodo } from './addTodo.tsx'
import type { Todo } from '../../data/todolist.ts'
import { routes } from '../../routes.ts'
import { customEvents } from '../utils/customEvents/index.tsx'

export const events = customEvents<{
  actionSubmitted: TodoActionDetail | null
  actionSucceeded: TodoActionDetail | null
  actionErrored: { error: Error }
}>()

export type TodoActionDetail = {
  completed?: boolean
}

export const TodoList = clientEntry(
  import.meta.url,
  function TodoList(handle: Handle<{ todos: Todo[] }>) {
    return () => <_TodoList todos={handle.props.todos} />
  },
)

export function _TodoList(handle: Handle<{ todos: Todo[] }>) {
  return () => (
    <div mix={[events.asHost(), events.on(({ type, detail }) => console.log(type, detail))]}>
      <AddTodo />
      <Frame
        name="TodoItems"
        src={routes.todolist.todos.index.href()}
        fallback={
          <div mix={css({ display: 'flex', alignItems: 'center' })}>
            <span
              aria-hidden="true"
              mix={css({
                width: 18,
                height: 18,
                border: '2px solid currentColor',
                borderRightColor: 'transparent',
                borderRadius: '50%',
                animation: 'todoActionSpin 0.8s linear infinite',
              })}
            />
            &nbsp;Loading todos...
          </div>
        }
      />
    </div>
  )
}
