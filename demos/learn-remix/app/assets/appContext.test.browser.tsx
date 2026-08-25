import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { addEventListeners, on, type Handle } from 'remix/ui'
import { render } from 'remix/ui/test'
import {
  AppProvider,
  AppContextEvents,
  EventUserDisplay,
  SettingsDisplay,
  UserDisplay2,
} from './appContext.tsx'

async function settleEvents() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('AppContext', () => {
  it('updates its model and emits only the affected events', () => {
    let context = AppContextEvents.define()
    let calls: string[] = []
    let controller = new AbortController()

    addEventListeners(context, controller.signal, {
      user(event) {
        calls.push(`user:${event.detail?.name ?? 'none'}`)
      },
      settings(event) {
        calls.push(`settings:${event.detail.theme}:${event.detail.layout}`)
      },
    })

    // Only the user slice was written, so only the user listener fires.
    context.dispatchEvent({ user: { name: 'Ada', age: 37 } })
    assert.equal(calls.join(','), 'user:Ada')
    assert.equal(context.detail.settings.theme, 'system')

    // A transaction touching both slices fires both listeners in order.
    context.dispatchEvent({
      user: { name: 'Grace', age: 85 },
      settings: { layout: 'zen', theme: 'dark' },
    })
    assert.equal(calls.join(','), 'user:Ada,user:Grace,settings:dark:zen')
  })

  it('supports explicit cleanup and AbortSignal-owned subscriptions', () => {
    let context = AppContextEvents.define()
    let userController = new AbortController()
    let settingsController = new AbortController()
    let cleanedCalls = 0
    let abortedCalls = 0

    addEventListeners(context, userController.signal, {
      user() {
        cleanedCalls++
      },
    })
    addEventListeners(context, settingsController.signal, {
      settings() {
        abortedCalls++
      },
    })

    context.dispatchEvent({
      user: { name: 'Ada', age: 37 },
      settings: { layout: 'zen', theme: 'light' },
    })
    assert.equal(cleanedCalls, 1)
    assert.equal(abortedCalls, 1)

    userController.abort()
    settingsController.abort()
    context.dispatchEvent({
      user: { name: 'Grace', age: 85 },
      settings: { layout: 'normal', theme: 'system' },
    })
    assert.equal(cleanedCalls, 1)
    assert.equal(abortedCalls, 1)
  })

  it('folds dispatches onto the live model in place', async () => {
    let context = AppContextEvents.define()

    await context.dispatchEvent({ user: { name: 'Ada', age: 37 } })
    assert.equal(context.detail.user?.name, 'Ada')
    assert.equal(context.detail.settings.theme, 'system')

    await context.dispatchEvent({ settings: { layout: 'zen', theme: 'dark' } })
    assert.equal(context.detail.settings.theme, 'dark')
    assert.equal(context.detail.user?.name, 'Ada')

    await context.dispatchEvent({
      user: { name: 'Grace', age: 85 },
      settings: { layout: 'normal', theme: 'light' },
    })
    assert.equal(context.detail.user?.name, 'Grace')
    assert.equal(context.detail.settings.theme, 'light')
  })

  it('provides context and updates imperative and event-aware consumers', async (t) => {
    function Controls(handle: Handle) {
      let events = handle.context.get(AppProvider)

      return () => (
        <nav>
          <button
            data-action="user"
            mix={on('click', () => {
              events.dispatchEvent({ user: { name: 'Ada', age: 37 } })
            })}
          >
            Set user
          </button>
          <button
            data-action="settings"
            mix={on('click', () => {
              events.dispatchEvent({ settings: { layout: 'normal', theme: 'dark' } })
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
            <UserDisplay2 />
          </div>
          <div data-consumer="event-user">
            <EventUserDisplay />
          </div>
          <div data-consumer="settings">
            <SettingsDisplay />
          </div>
          <Controls />
        </section>
      </AppProvider>,
    )
    t.after(() => result.cleanup())

    await result.act(settleEvents)

    assert.equal(result.$('[data-consumer="user"]')?.textContent, 'Bob Lazar')
    assert.equal(result.$('[data-consumer="event-user"]')?.textContent, 'Bob Lazar')
    assert.equal(result.$('[data-consumer="user"]')?.textContent, 'Bob Lazar')
    assert.equal(
      result.$('[data-consumer="settings"]')?.textContent?.trim(),
      'Layout: zen, Theme: light',
    )

    await result.act(() => (result.$('[data-action="user"]') as HTMLButtonElement).click())
    await result.act(settleEvents)

    assert.equal(result.$('[data-consumer="user"]')?.textContent, 'Ada')
    assert.equal(result.$('[data-consumer="event-user"]')?.textContent, 'Ada')
    assert.equal(result.$('[data-consumer="user"]')?.textContent, 'Ada')
    assert.equal(
      result.$('[data-consumer="settings"]')?.textContent?.trim(),
      'Layout: zen, Theme: light',
    )

    await result.act(() => (result.$('[data-action="settings"]') as HTMLButtonElement).click())
    await result.act(settleEvents)

    assert.equal(result.$('[data-consumer="user"]')?.textContent, 'Ada')
    assert.equal(result.$('[data-consumer="event-user"]')?.textContent, 'Ada')
    assert.equal(result.$('[data-consumer="user"]')?.textContent, 'Ada')
    assert.equal(
      result.$('[data-consumer="settings"]')?.textContent?.trim(),
      'Layout: normal, Theme: dark',
    )
  })
})