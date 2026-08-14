import type { Handle, RemixNode } from 'remix/ui'
import { customEvents, evented } from './utils/customEvents/index.tsx'

export type AppContextValue = {
  user: { name: string; age: number } | null
  settings: {
    theme: 'dark' | 'light' | 'system'
    layout: 'zen' | 'normal'
  }
}

export function createAppContext() {
  return customEvents({
    root: {
      user: null as AppContextValue['user'],
      settings: { layout: 'normal', theme: 'system' },
    },
  })
}

export type AppContext = ReturnType<typeof createAppContext>

export function AppProvider(handle: Handle<{ children?: RemixNode }, AppContext>) {
  let events = createAppContext()
  handle.context.set(events)

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
export function UserDisplay(handle: Handle) {
  let events = handle.context.get(AppProvider)

  return () => (
    <div>
      <evented.div eventSource={events.on.user.name}>
        {(name) => name ?? 'Not logged in'}
      </evented.div>
    </div>
  )
}

export function EventUserDisplay(handle: Handle) {
  let events = handle.context.get(AppProvider)

  return () => (
    <div>
      <evented.div eventSource={events.on.user.name}>
        {(user) => user ?? 'Not logged in'}
      </evented.div>
    </div>
  )
}

export function SettingsDisplay(handle: Handle) {
  let events = handle.context.get(AppProvider)

  return () => (
    <div>
      <evented.div eventSource={events.on.settings}>
        {(settings) => `Layout: ${settings.layout}, Theme: ${settings.theme}`}
      </evented.div>
    </div>
  )
}

export function EventSettingsDisplay(handle: Handle) {
  let events = handle.context.get(AppProvider)

  return () => (
    <evented.pre eventSource={events.on.settings}>
      {(settings) => `Layout: ${settings.layout}, Theme: ${settings.theme}`}
    </evented.pre>
  )
}
