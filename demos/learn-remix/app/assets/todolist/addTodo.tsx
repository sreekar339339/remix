import { css, on, ref, type Dispatched, type Handle, type Props } from 'remix/ui'
import { routes } from '../../routes.ts'
import { evented } from '../utils/customEvents/index.tsx'
import { events } from './todoList.tsx'

export function AddTodo(handle: Handle<Props<'form'>>) {
  let onSubmit = async (evt: Dispatched<SubmitEvent, HTMLFormElement>, signal: AbortSignal) => {
    evt.preventDefault()
    let form = evt.currentTarget
    let submitter = evt.submitter as HTMLButtonElement
    let formData = new FormData(form, submitter)
    if (formData.get('text') === '') return form.focus()
    formData.set('redirectTo', 'none')
    let opts = { composed: true, signal }
    try {
      form.dispatchEvent(events.create({ actionSubmitted: null }, opts))
      // await new Promise((res, rej) => setTimeout(rej, 2000, new Error('laude lag gaye')));
      let resp = await fetch(new URL(form.action), {
        method: 'POST',
        body: formData,
        signal,
      })
      if (!resp.ok) {
        throw new Error(`${resp.status} ${resp.statusText}`, {
          cause: await resp.text(),
        })
      }
      await handle.frames.get('TodoItems')!.reload()
      form.dispatchEvent(events.create({ actionSucceeded: null }, opts))
    } catch (error) {
      form.dispatchEvent(events.create({ actionErrored: { error: error as Error } }, opts))
    }
  }

  return () => (
    <form
      method="POST"
      action={routes.todolist.todos.action.href()}
      mix={[
        css({ display: 'flex', alignItems: 'center', gap: 8 }),
        on('submit', onSubmit),
        events.asHost(),
        events.on.actionSucceeded(({ currentTarget }) => {
          currentTarget.reset()
        }),
      ]}
    >
      <label>
        Enter a todo{' '}
        <evented.input
          on={events.on['*']}
          disabled={(_, event) => event?.type === 'actionSubmitted'}
          class={(_, event) => (event?.type === 'actionSubmitted' ? 'pending' : '')}
          mix={[
            inputCss,
            events.on['*'](({ currentTarget, type }) => {
              if (type !== 'actionSubmitted') {
                currentTarget.select()
              }
            }),
            ref((input) => input.select()),
          ]}
          name="text"
        />
      </label>
      <button name="intent" value="create">
        Add
      </button>
    </form>
  )
}

const inputCss = css({
  padding: 4,
  font: 'inherit',
  color: 'inherit',
  '&.pending': {
    color: 'var(--text-primary)',
    backgroundColor: 'var(--surface-4)',
    backgroundImage:
      'linear-gradient(100deg, transparent 0%, transparent 35%, rgba(45, 172, 249, 0.28) 50%, transparent 65%, transparent 100%)',
    backgroundSize: '220% 100%',
    animation: 'glimmer 1.15s linear infinite',
    borderColor: 'var(--brand-blue)',
  },
  '@media (prefers-reduced-motion: reduce)': {
    '&.pending': {
      animation: 'none',
    },
  },
})
