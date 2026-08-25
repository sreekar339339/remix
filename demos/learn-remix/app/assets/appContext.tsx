import { addEventListeners, type Handle, type RemixNode } from 'remix/ui'
import { Events, evented as e, type CustomEventsDefined } from './utils/customEvents/index.tsx'

export class AppContextEvents extends Events {
  user: { name: string; age: number } | null = null
  settings: {
    theme: 'dark' | 'light' | 'system'
    layout: 'zen' | 'normal'
  } = { layout: 'normal', theme: 'system' }
}

export function AppProvider(
  handle: Handle<{ children?: RemixNode }, CustomEventsDefined<AppContextEvents>>,
) {
  let events = AppContextEvents.define()
  handle.context.set(events)

  handle.queueTask(async () => {
    // perform auth and other async stuff and dispatch the context value
    events.dispatchEvent({
      user: { age: 23, name: 'Bob Lazar' },
      settings: { layout: 'zen', theme: 'light' },
    })
  })

  return () => <body>{handle.props.children}</body>
}

// Components subscribe to the shared descriptor with evented views or the
// descriptor's own EventTarget channel (addEventListener/addEventListeners).
export function UserDisplay2(handle: Handle) {
  let events = handle.context.get(AppProvider)

  addEventListeners(events, handle.signal, {
    user() {
      handle.update()
    },
  })

  return () => (
    <div>
      <div>{events.detail.user?.name ?? 'Not logged in'}</div>
    </div>
  )
}

export function EventUserDisplay(handle: Handle) {
  let events = handle.context.get(AppProvider)

  return () => (
    <div>
      <e.div on={events.on.user.name}>{(user) => user ?? 'Not logged in'}</e.div>
    </div>
  )
}

export function SettingsDisplay(handle: Handle) {
  let events = handle.context.get(AppProvider)

  return () => (
    <div>
      <e.div on={events.on.settings}>
        {(settings) => `Layout: ${settings.layout}, Theme: ${settings.theme}`}
      </e.div>
    </div>
  )
}
