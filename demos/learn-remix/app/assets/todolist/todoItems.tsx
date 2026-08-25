import { clientEntry, css, on, type Dispatched, type Handle } from 'remix/ui'
import { routes } from '../../routes.ts'
import type { Todo } from '../../data/todolist.ts'
import { evented as e } from '../utils/customEvents/index.tsx'
import { events, type TodoActionDetail } from './todoList.tsx'

const todoListCss = css({
  listStyleType: 'none',
  padding: 0,
})

const todoItemCss = css({
  marginTop: 4,
  display: 'flex',
  alignItems: 'center',
  '& > form:nth-child(2)': {
    flex: '1',
    '& > input': {
      width: '95%',
    },
  },
})

const todoActionButtonCss = css({
  position: 'relative',
  boxSizing: 'border-box',
  border: '1px solid transparent',
  borderRadius: '9999px',
  cursor: 'pointer',
  padding: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  '&.pending::before': {
    content: '""',
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 34,
    height: 34,
    marginTop: -17,
    marginLeft: -17,
    borderRadius: '9999px',
    border: '2px solid transparent',
    borderTopColor: 'var(--brand-blue)',
    borderRightColor: 'rgba(45, 172, 249, 0.35)',
    animation: 'todoActionSpin 0.75s linear infinite',
    pointerEvents: 'none',
  },
  '@media (prefers-reduced-motion: reduce)': {
    '&.pending::before': {
      animation: 'none',
    },
  },
})

const deleteTodoButtonCss = css({
  width: 28,
  height: 28,
  backgroundColor: 'transparent',
  '&.pending': {
    color: 'var(--text-primary)',
  },
})

const editTodoInputCss = css({
  borderColor: 'transparent',
  backgroundColor: 'transparent',
  padding: 2,
  font: 'inherit',
  color: 'inherit',
  outline: 'none',
  '&:focus,&:hover': {
    backgroundColor: 'revert',
    outline: 'revert',
    borderColor: 'revert',
  },
  '&.pending': {
    backgroundImage:
      'linear-gradient(100deg, transparent 0%, transparent 35%, rgba(45, 172, 249, 0.28) 50%, transparent 65%, transparent 100%)',
    backgroundSize: '220% 100%',
    animation: 'glimmer 1.15s linear infinite',
  },
  '@media (prefers-reduced-motion: reduce)': {
    '&.pending': {
      animation: 'none',
    },
  },
})

const completeTodoButtonCss = css({
  width: 28,
  height: 28,
  border: '1px solid #ccc',
  backgroundColor: '#fff',
  color: '#111',
  fontSize: '18px',
})

function getTodoActionDetail(formData: FormData): TodoActionDetail {
  let completed = formData.get('completed')

  return typeof completed === 'string' ? { completed: completed === 'true' } : {}
}

export function TodoItems(handle: Handle<{ todos: Todo[] }>) {
  let onSubmit = async (evt: Dispatched<SubmitEvent, HTMLUListElement>) => {
    evt.preventDefault()
    let form = evt.target as HTMLFormElement
    let submitter = evt.submitter as HTMLButtonElement
    let formData = new FormData(form, submitter)
    formData.set('redirectTo', 'none')
    let opts = { composed: true }
    let actionDetail = getTodoActionDetail(formData)
    try {
      form.dispatchEvent(events.create({ actionSubmitted: actionDetail }, opts))
      // await new Promise((res, rej) => setTimeout(rej, 25000, new Error('laude lag gaye')));
      let resp = await fetch(form.action, {
        method: 'POST',
        body: formData,
      })
      if (!resp.ok) {
        throw new Error(`${resp.status} ${resp.statusText}`, {
          cause: await resp.text(),
        })
      }
      await handle.frame.reload()
      form.dispatchEvent(events.create({ actionSucceeded: actionDetail }, opts))
    } catch (error) {
      form.dispatchEvent(events.create({ actionErrored: { error: error as Error } }, opts))
    }
  }

  return () => (
    <ul mix={[todoListCss, on('submit', onSubmit)]}>
      {handle.props.todos.map(({ id, completed, text }) => (
        <li key={id} mix={todoItemCss}>
          <form method="POST" action={routes.todolist.todos.action.href()} mix={events.asHost()}>
            <e.button
              on={events.on['*']}
              mix={[todoActionButtonCss, deleteTodoButtonCss]}
              name="intent"
              value="delete"
              disabled={(_, event) => event?.type === 'actionSubmitted'}
              class={(_, event) => (event?.type === 'actionSubmitted' ? 'pending' : '')}
            >
              🗑️
            </e.button>
            <input hidden name="id" value={id} />
          </form>
          <e.form
            on={events.on['*']}
            data-action={(_, event) => event?.type}
            mix={[
              events.asHost(),
              events.on.actionErrored(({ currentTarget }) => {
                currentTarget.reset()
              }),
              on('focusout', ({ currentTarget }) => {
                if (currentTarget.dataset.action === 'actionSubmitted') return
                currentTarget.reset()
              }),
            ]}
            method="POST"
            action={routes.todolist.todos.action.href()}
          >
            <button hidden name="intent" value="update" />
            <input hidden name="id" value={id} />
            <e.input
              on={events.on['*']}
              mix={[editTodoInputCss]}
              defaultValue={text}
              name="text"
              disabled={(_, event) => event?.type === 'actionSubmitted'}
              class={(_, event) => (event?.type === 'actionSubmitted' ? 'pending' : '')}
            />
          </e.form>
          <form method="POST" action={routes.todolist.todos.action.href()} mix={events.asHost()}>
            <input hidden name="completed" value={String(!completed)} />
            <input hidden name="id" value={id} />
            <e.button
              on={events.on['*']}
              disabled={(_, event) => event?.type === 'actionSubmitted'}
              class={(_, event) => (event?.type === 'actionSubmitted' ? 'pending' : '')}
              name="intent"
              value="update"
              mix={[completeTodoButtonCss]}
            >
              {(_, event) =>
                (event?.type === 'actionSubmitted' ? event.detail?.completed ?? completed : completed)
                  ? '✓'
                  : 'x'
              }
            </e.button>
          </form>
        </li>
      ))}
    </ul>
  )
}

export const TodoItemsClientEntryMarked = clientEntry(
  import.meta.url,
  function TodoItemsClientEntryMarked(handle: Handle<{ todos: Todo[] }>) {
    return () => <TodoItems todos={handle.props.todos} />
  },
)
