import { addEventListeners, type Handle, type RemixNode } from 'remix/ui'
import { customEvents, evented } from './utils/customEvents/index.tsx'

export type AppContextValue = {
  user: { name: string; age: number } | null
  settings: {
    theme: 'dark' | 'light' | 'system'
    layout: 'zen' | 'normal'
  }
}

export const appContextEvents = customEvents<AppContextValue>()
export type AppContext = ReturnType<typeof appContextEvents.store<AppContextValue>>

export function AppProvider(handle: Handle<{ children?: RemixNode }, AppContext>) {
  let appContext = appContextEvents.store({
    user: null,
    settings: { layout: 'normal', theme: 'system' },
  })
  let { state } = appContext
  handle.context.set(appContext)

  handle.queueTask(async (signal) => {
    // perform auth and other async stuff and dispatch context value
    state.update((draft) => {
      draft.user = { age: 23, name: 'Bob Lazar' }
      draft.settings = { layout: 'zen', theme: 'light' }
    })
  })

  return () => <body>{handle.props.children}</body>
}

// Components can subscribe to only the events they care about
export function UserDisplay(handle: Handle) {
  let { state, host } = handle.context.get(AppProvider)

  addEventListeners(host, handle.signal, {
    user() {
      void handle.update()
    },
  })

  return () => <div>{state.value.user?.name ?? 'Not logged in'}</div>
}

// Event-aware elements can display context values without calling handle.update().
export function EventUserDisplay(handle: Handle) {
  let { events } = handle.context.get(AppProvider)

  return () => (
    <div>
      <evented.div eventSource={events.user.name}>
        {(detail) => detail ?? 'Not logged in'}
      </evented.div>
    </div>
  )
}

export function SettingsDisplay(handle: Handle) {
  let { state, host } = handle.context.get(AppProvider)

  addEventListeners(host, handle.signal, {
    settings() {
      void handle.update()
    },
  })

  return () => (
    <div>
      <pre>
        Layout: {state.value.settings.layout}, Theme: {state.value.settings.theme}
      </pre>
    </div>
  )
}

export function EventSettingsDisplay(handle: Handle) {
  let { events } = handle.context.get(AppProvider)

  return () => (
    <evented.pre eventSource={events.settings}>
      {(detail) => `Layout: ${detail.layout}, Theme: ${detail.theme}`}
    </evented.pre>
  )
}
