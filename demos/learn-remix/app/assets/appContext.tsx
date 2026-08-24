import { addEventListeners, type Handle, type RemixNode } from 'remix/ui'
import { Events, evented, type CustomEventsEventMap, type EventsApi } from './utils/customEvents/index.tsx'

export type AppContextValue = {
  user: { name: string; age: number } | null
  settings: {
    theme: 'dark' | 'light' | 'system'
    layout: 'zen' | 'normal'
  }
}

export class AppContextEvents extends Events {
  // The descriptor's EventTarget channel is typed through its event map, so
  // addEventListeners(events, ...) narrows the named listeners.
  declare readonly __eventMap?: CustomEventsEventMap<{ context: AppContextValue }>

  context: AppContextValue

  constructor(_api: EventsApi<AppContextEvents>, context: AppContextValue) {
    super()
    this.context = context
  }
}

export const createAppContext = (value: AppContextValue) => AppContextEvents.define(value)
export function AppProvider(handle: Handle<
  { children?: RemixNode },
  ReturnType<typeof createAppContext>
>) {
  let events = createAppContext({
    user: null,
    settings: { layout: 'normal', theme: 'system' },
  })
  handle.context.set(events)

  handle.queueTask(async () => {
    // perform auth and other async stuff and dispatch the context value
    events.dispatchEvent({
      context: {
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
  let events = handle.context.get(AppProvider)

  addEventListeners(events, handle.signal, {
    context() {
      handle.update()
    },
  })

  return () => (
    <div>
      <div>{events.detail.context.user?.name ?? 'Not logged in'}</div>
    </div>
  )
}

export function EventUserDisplay(handle: Handle) {
  let events = handle.context.get(AppProvider)

  return () => (
    <div>
      <evented.div on={events.on.context.user.name}>
        {(user) => user ?? 'Not logged in'}
      </evented.div>
    </div>
  )
}

export function SettingsDisplay(handle: Handle) {
  let events = handle.context.get(AppProvider)

  return () => (
    <div>
      <evented.div on={events.on.context.settings}>
        {(settings) => `Layout: ${settings.layout}, Theme: ${settings.theme}`}
      </evented.div>
    </div>
  )
}