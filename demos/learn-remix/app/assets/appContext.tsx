import { addEventListeners, type Handle, type RemixNode } from 'remix/ui'
import { customEvents, evented } from './utils/customEvents/index.tsx'

export type AppContextValue = {
  user: { name: string; age: number } | null
  settings: {
    theme: 'dark' | 'light' | 'system'
    layout: 'zen' | 'normal'
  }
}

export const createAppContext = (value: AppContextValue) =>
  customEvents({
    root: value,
  })

export function AppProvider(
  handle: Handle<
    { children?: RemixNode },
    { events: ReturnType<typeof createAppContext>; value: AppContextValue }
  >,
) {
  let value: AppContextValue = {
    user: null,
    settings: { layout: 'normal', theme: 'system' },
  }
  let events = createAppContext(value)
  handle.context.set({ events, value })

  handle.queueTask(async () => {
    // perform auth and other async stuff and dispatch context value
    events.dispatchEvent({
      root: {
        user: { age: 23, name: 'Bob Lazar' },
        settings: { layout: 'zen', theme: 'light' },
      },
    })
  })

  return () => <body>{handle.props.children}</body>
}

// Components subscribe to the shared descriptor with evented views or the
// descriptor's own EventTarget channel (addEventListener/addEventListeners).
export function UserDisplay2(handle: Handle) {
  let { events, value } = handle.context.get(AppProvider)

  addEventListeners(events, handle.signal, {
    user() {
      handle.update()
    },
  })

  return () => (
    <div>
      <div>{value.user?.name ?? 'Not logged in'}</div>
    </div>
  )
}

export function EventUserDisplay(handle: Handle) {
  let { events } = handle.context.get(AppProvider)

  return () => (
    <div>
      <evented.div on={events.on.user.name}>
        {(user) => user ?? 'Not logged in'}
      </evented.div>
    </div>
  )
}

export function SettingsDisplay(handle: Handle) {
  let { events } = handle.context.get(AppProvider)

  return () => (
    <div>
      <evented.div on={events.on.settings}>
        {(settings) => `Layout: ${settings.layout}, Theme: ${settings.theme}`}
      </evented.div>
    </div>
  )
}
