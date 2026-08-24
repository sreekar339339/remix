import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { addEventListeners, on, type Handle } from 'remix/ui'
import { render } from 'remix/ui/test'
import {
  AppProvider,
  createAppContext,
  EventUserDisplay,
  SettingsDisplay,
  UserDisplay2,
} from './appContext.tsx'
import type { AppContextValue } from './appContext.tsx'

async function settleEvents() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('AppContext', () => {
  it('updates its model and emits only the affected events', () => {
    let context = createAppContext({
      user: null,
      settings: { layout: 'normal', theme: 'system' },
    })
    let calls: string[] = []
    let controller = new AbortController()

    addEventListeners(context, controller.signal, {
      context(event) {
        calls.push(`context:${event.detail.user?.name ?? 'none'}`)
      },
    })
    context.dispatchEvent({
      context: { user: { name: 'Ada', age: 37 }, settings: { layout: 'normal', theme: 'system' } },
    })

    assert.equal(calls.join(','), 'context:Ada')

    context.dispatchEvent({
      context: {
        user: { name: 'Grace', age: 85 },
        settings: { layout: 'zen', theme: 'dark' },
      },
    })

    assert.equal(calls.join(','), 'context:Ada,context:Grace')
  })

  it('supports explicit cleanup and AbortSignal-owned subscriptions', () => {
    let context = createAppContext({
      user: null,
      settings: { layout: 'normal', theme: 'system' },
    })
    let userController = new AbortController()
    let settingsController = new AbortController()
    let cleanedCalls = 0
    let abortedCalls = 0

    let firstController = new AbortController()
    let secondController = new AbortController()

    addEventListeners(context, firstController.signal, {
      context() {
        cleanedCalls++
      },
    })
    addEventListeners(context, secondController.signal, {
      context() {
        abortedCalls++
      },
    })

    context.dispatchEvent({
      context: {
        user: { name: 'Ada', age: 37 },
        settings: { layout: 'zen', theme: 'light' },
      },
    })
    assert.equal(cleanedCalls, 1)
    assert.equal(abortedCalls, 1)

    firstController.abort()
    secondController.abort()
    context.dispatchEvent({
      context: {
        user: { name: 'Grace', age: 85 },
        settings: { layout: 'normal', theme: 'system' },
      },
    })
    assert.equal(cleanedCalls, 1)
    assert.equal(abortedCalls, 1)
  })

  it('folds dispatches into the root seed object in place', async () => {
    let value: AppContextValue = {
      user: null,
      settings: { layout: 'normal', theme: 'system' },
    }
    let context = createAppContext(value)

    await context.dispatchEvent({
      context: { ...value, user: { name: 'Ada', age: 37 } },
    })
    assert.equal(context.detail.context.user?.name, 'Ada')
    assert.equal(context.detail.context.settings.theme, 'system')

    await context.dispatchEvent({
      context: { ...context.detail.context, settings: { layout: 'zen', theme: 'dark' } },
    })
    assert.equal(context.detail.context.settings.theme, 'dark')
    assert.equal(context.detail.context.user?.name, 'Ada')

    await context.dispatchEvent({
      context: {
        user: { name: 'Grace', age: 85 },
        settings: { layout: 'normal', theme: 'light' },
      },
    })
    assert.equal(context.detail.context.user?.name, 'Grace')
    assert.equal(context.detail.context.settings.theme, 'light')
  })

  it('provides context and updates imperative and event-aware consumers', async (t) => {
    function Controls(handle: Handle) {
      let events = handle.context.get(AppProvider)

      return () => (
        <nav>
          <button
            data-action="user"
            mix={on('click', () => {
              events.dispatchEvent({
                context: { ...events.detail.context, user: { name: 'Ada', age: 37 } },
              })
            })}
          >
            Set user
          </button>
          <button
            data-action="settings"
            mix={on('click', () => {
              events.dispatchEvent({
                context: { ...events.detail.context, settings: { layout: 'normal', theme: 'dark' } },
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
