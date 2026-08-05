import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { addEventListeners, on, type Handle } from 'remix/ui'
import { render } from 'remix/ui/test'
import {
  appContextEvents,
  AppProvider,
  EventSettingsDisplay,
  EventUserDisplay,
  SettingsDisplay,
  UserDisplay,
} from './appContext.tsx'

async function settleEvents() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('AppContext', () => {
  it('updates its model and emits only the affected events', () => {
    let context = appContextEvents.store({
      user: null,
      settings: { layout: 'normal', theme: 'system' },
    })
    let calls: string[] = []
    let controller = new AbortController()

    assert.equal(context.state.value.user, null)
    assert.deepEqual(context.state.value.settings, {
      layout: 'normal',
      theme: 'system',
    })

    addEventListeners(context.host, controller.signal, {
      user(event) {
        calls.push(`named:${event.detail?.name ?? 'none'}`)
      },
      settings(event) {
        calls.push(`map:${event.detail.theme}:${event.detail.layout}`)
      },
    })
    context.state.update((draft) => {
      draft.user = { name: 'Ada', age: 37 }
    })

    assert.deepEqual(context.state.value.user, { name: 'Ada', age: 37 })
    assert.equal(calls.join(','), 'named:Ada')

    context.state.update((draft) => {
      draft.user = { name: 'Grace', age: 85 }
      draft.settings = { layout: 'zen', theme: 'dark' }
    })

    assert.deepEqual(context.state.value.user, { name: 'Grace', age: 85 })
    assert.deepEqual(context.state.value.settings, { layout: 'zen', theme: 'dark' })
    assert.equal(calls.join(','), 'named:Ada,named:Grace,map:dark:zen')
  })

  it('supports explicit cleanup and AbortSignal-owned subscriptions', () => {
    let context = appContextEvents.store({
      user: null,
      settings: { layout: 'normal', theme: 'system' },
    })
    let userController = new AbortController()
    let settingsController = new AbortController()
    let cleanedCalls = 0
    let abortedCalls = 0

    addEventListeners(context.host, userController.signal, {
      user() {
        cleanedCalls++
      },
    })
    addEventListeners(context.host, settingsController.signal, {
      settings() {
        abortedCalls++
      },
    })

    context.state.update((draft) => {
      draft.user = { name: 'Ada', age: 37 }
      draft.settings = { layout: 'zen', theme: 'light' }
    })
    assert.equal(cleanedCalls, 1)
    assert.equal(abortedCalls, 1)

    userController.abort()
    settingsController.abort()
    context.state.update((draft) => {
      draft.user = null
      draft.settings = { layout: 'normal', theme: 'system' }
    })
    assert.equal(cleanedCalls, 1)
    assert.equal(abortedCalls, 1)
  })

  it('provides context and updates imperative and event-aware consumers', async (t) => {
    function Controls(handle: Handle) {
      let context = handle.context.get(AppProvider)

      return () => (
        <nav>
          <button
            data-action="user"
            mix={on('click', () => {
              context.state.update((draft) => {
                draft.user = { name: 'Ada', age: 37 }
              })
            })}
          >
            Set user
          </button>
          <button
            data-action="settings"
            mix={on('click', () => {
              context.state.update((draft) => {
                draft.settings = { layout: 'normal', theme: 'dark' }
              })
            })}
          >
            Set settings
          </button>
        </nav>
      )
    }

    let result = render(
      <AppProvider>
        <section>
          <div data-consumer="user">
            <UserDisplay />
          </div>
          <div data-consumer="event-user">
            <EventUserDisplay />
          </div>
          <div data-consumer="settings">
            <SettingsDisplay />
          </div>
          <div data-consumer="event-settings">
            <EventSettingsDisplay />
          </div>
          <Controls />
        </section>
      </AppProvider>,
    )
    t.after(() => result.cleanup())

    await result.act(settleEvents)

    assert.equal(result.$('[data-consumer="user"]')?.textContent, 'Bob Lazar')
    assert.equal(result.$('[data-consumer="event-user"]')?.textContent, 'Bob Lazar')
    assert.equal(
      result.$('[data-consumer="settings"]')?.textContent?.trim(),
      'Layout: zen, Theme: light',
    )
    assert.equal(
      result.$('[data-consumer="event-settings"]')?.textContent,
      'Layout: zen, Theme: light',
    )

    await result.act(() => (result.$('[data-action="user"]') as HTMLButtonElement).click())
    await result.act(settleEvents)

    assert.equal(result.$('[data-consumer="user"]')?.textContent, 'Ada')
    assert.equal(result.$('[data-consumer="event-user"]')?.textContent, 'Ada')
    assert.equal(
      result.$('[data-consumer="settings"]')?.textContent?.trim(),
      'Layout: zen, Theme: light',
    )
    assert.equal(
      result.$('[data-consumer="event-settings"]')?.textContent,
      'Layout: zen, Theme: light',
    )

    await result.act(() => (result.$('[data-action="settings"]') as HTMLButtonElement).click())
    await result.act(settleEvents)

    assert.equal(result.$('[data-consumer="user"]')?.textContent, 'Ada')
    assert.equal(result.$('[data-consumer="event-user"]')?.textContent, 'Ada')
    assert.equal(
      result.$('[data-consumer="settings"]')?.textContent?.trim(),
      'Layout: normal, Theme: dark',
    )
    assert.equal(
      result.$('[data-consumer="event-settings"]')?.textContent,
      'Layout: normal, Theme: dark',
    )
  })
})
