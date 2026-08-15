import { expect } from '@remix-run/assert'
import { describe, it } from '@remix-run/test'
import { renderToString } from '@remix-run/ui/server'

import { createRoot } from '../runtime/vdom.ts'
import { invariant } from '../runtime/invariant.ts'
import {
  EVENT_SOURCE,
  getEventSourceProtocol,
  type EventSource,
  type EventSourceEvent,
} from '../index.ts'

type FakeSource = EventSource & {
  fire(detail?: unknown): void
  subscriberCount(): number
}

function createFakeSource(
  type: string,
  options?: { value?: unknown; retained?: boolean },
): FakeSource {
  let target = new EventTarget()
  let value = options?.value
  let retained = options?.retained ?? true
  let subscribers = 0
  return {
    [EVENT_SOURCE]: {
      type,
      ...(retained ? { read: () => value } : {}),
      subscribe(subscriber, signal) {
        subscribers++
        let listener = (event: Event) => subscriber.notify(event as EventSourceEvent)
        target.addEventListener(type, listener)
        signal.addEventListener('abort', () => {
          subscribers--
          target.removeEventListener(type, listener)
        })
      },
    },
    fire(detail?: unknown) {
      if (retained) value = detail
      target.dispatchEvent(new CustomEvent(type, { detail: detail ?? null }))
    },
    subscriberCount() {
      return subscribers
    },
  }
}

describe('on host prop', () => {
  it('renders initial values from retained sources', () => {
    let name = createFakeSource('name', { value: 'Ada' })

    let container = document.createElement('div')
    let root = createRoot(container)
    root.render(
      <output on={name} data-name={(detail: unknown) => detail as string}>
        {(detail: unknown) => detail as string}
      </output>,
    )
    root.flush()

    let output = container.querySelector('output')
    invariant(output)
    expect(output.dataset.name).toBe('Ada')
    expect(output.textContent).toBe('Ada')
    expect(output.hasAttribute('on')).toBe(false)
  })

  it('updates attributes and children through the vdom when a source fires', () => {
    let count = createFakeSource('count', { value: 0 })

    let container = document.createElement('div')
    let root = createRoot(container)
    root.render(
      <button on={count} disabled={(count) => (count as number) >= 2}>
        {(count) => `count: ${count}`}
      </button>,
    )
    root.flush()

    let button = container.querySelector('button')
    invariant(button)
    expect(button.textContent).toBe('count: 0')
    expect(button.disabled).toBe(false)

    count.fire(1)
    root.flush()
    expect(button.textContent).toBe('count: 1')
    expect(button.disabled).toBe(false)

    count.fire(2)
    root.flush()
    expect(button.textContent).toBe('count: 2')
    expect(button.disabled).toBe(true)
  })

  it('reads several sources as an index-aligned tuple', () => {
    let first = createFakeSource('first', { value: 'Ada' })
    let last = createFakeSource('last', { value: 'Lovelace' })

    let container = document.createElement('div')
    let root = createRoot(container)
    root.render(
      <output on={[first, last]}>
        {(value) => {
          let [firstName, lastName] = value as [string, string]
          return `${firstName} ${lastName}`
        }}
      </output>,
    )
    root.flush()

    let output = container.querySelector('output')
    invariant(output)
    expect(output.textContent).toBe('Ada Lovelace')

    last.fire('Byron')
    root.flush()
    expect(output.textContent).toBe('Ada Byron')
  })

  it('renders the initial prop until an occurrence first matches', () => {
    let submitted = createFakeSource('submitted', { retained: false })

    let container = document.createElement('div')
    let root = createRoot(container)
    root.render(
      <output on={submitted} initial={{ type: 'submitted', detail: 'waiting' }}>
        {(value: unknown, event?: EventSourceEvent) =>
          `${(event as EventSourceEvent).type}: ${(value as string) ?? 'no detail'}`
        }
      </output>,
    )
    root.flush()

    let output = container.querySelector('output')
    invariant(output)
    expect(output.textContent).toBe('submitted: waiting')

    submitted.fire('order-1')
    root.flush()
    expect(output.textContent).toBe('submitted: order-1')
  })

  it('matches any event type against wildcard sources', () => {
    let target = new EventTarget()
    let wildcard: EventSource = {
      [EVENT_SOURCE]: {
        type: '*',
        subscribe(subscriber, signal) {
          let listener = (event: Event) => subscriber.notify(event as EventSourceEvent)
          target.addEventListener('ready', listener)
          signal.addEventListener('abort', () => target.removeEventListener('ready', listener))
        },
      },
    }

    let container = document.createElement('div')
    let root = createRoot(container)
    root.render(
      <output
        on={wildcard}
        initial={{ type: 'idle', detail: 'waiting' }}
        data-type={(value: unknown, event?: EventSourceEvent) => (event as EventSourceEvent).type}
      >
        {(value: unknown, event?: EventSourceEvent) =>
          `${(event as EventSourceEvent).type}: ${value as string}`
        }
      </output>,
    )
    root.flush()

    let output = container.querySelector('output')
    invariant(output)
    expect(output.dataset.type).toBe('idle')
    expect(output.textContent).toBe('idle: waiting')

    target.dispatchEvent(new CustomEvent('ready', { detail: 'done' }))
    root.flush()
    expect(output.dataset.type).toBe('ready')
    expect(output.textContent).toBe('ready: done')
  })

  it('keeps the event value across parent re-renders', () => {
    let selected = createFakeSource('selected', { value: false })

    function Item(handle: { props: { label: string } }) {
      return () => (
        <div>
          <span>{handle.props.label}</span>
          <button on={selected} aria-pressed={(selected) => selected as boolean}>
            {(selected) => (selected ? 'selected' : 'not selected')}
          </button>
        </div>
      )
    }

    let container = document.createElement('div')
    let root = createRoot(container)
    root.render(<Item label="first" />)
    root.flush()

    let button = container.querySelector('button')
    invariant(button)
    selected.fire(true)
    root.flush()
    expect(button.textContent).toBe('selected')
    expect(button.getAttribute('aria-pressed')).toBe('true')

    root.render(<Item label="second" />)
    root.flush()
    expect(container.querySelector('span')?.textContent).toBe('second')
    expect(button.textContent).toBe('selected')
    expect(button.getAttribute('aria-pressed')).toBe('true')
  })

  it('unsubscribes when the element is removed', () => {
    let source = createFakeSource('value', { value: 1 })

    let container = document.createElement('div')
    let root = createRoot(container)
    root.render(<output on={source}>{(value) => value as string}</output>)
    root.flush()
    expect(source.subscriberCount()).toBe(1)

    root.render(<p>replaced</p>)
    root.flush()
    expect(source.subscriberCount()).toBe(0)

    source.fire(2)
    root.flush()
    expect(container.querySelector('p')?.textContent).toBe('replaced')
  })

  it('rejects non-source values', () => {
    let container = document.createElement('div')
    let root = createRoot(container)
    let errors: unknown[] = []
    root.addEventListener('error', (event) => {
      errors.push((event as { error?: unknown }).error)
    })

    root.render(<output on={42 as never} />)
    root.flush()

    expect(errors.length).toBe(1)
    expect(errors[0] instanceof TypeError).toBe(true)
    expect((errors[0] as TypeError).message).toBe('on accepts event sources.')
  })

  it('rejects two sources with the same event type', () => {
    let first = createFakeSource('same', { value: 1 })
    let second = createFakeSource('same', { value: 2 })

    let container = document.createElement('div')
    let root = createRoot(container)
    let errors: unknown[] = []
    root.addEventListener('error', (event) => {
      errors.push((event as { error?: unknown }).error)
    })

    root.render(<output on={[first, second]} />)
    root.flush()

    expect(errors.length).toBe(1)
    expect(errors[0] instanceof TypeError).toBe(true)
    expect((errors[0] as TypeError).message).toBe(
      'An event-aware element accepts one source per event type.',
    )
  })

  it('renders initial values on the server and omits framework props', async () => {
    let name = createFakeSource('name', { value: 'Ada' })

    let html = await renderToString(
      <output on={name} data-name={(name: unknown) => name as string}>
        {(name: unknown) => name as string}
      </output>,
    )

    expect(html).toContain('data-name="Ada"')
    expect(html).toContain('>Ada</output>')
    expect(html).not.toContain('on')
    expect(html).not.toContain('initial=')
  })

  it('exposes the source protocol through getEventSourceProtocol', () => {
    let source = createFakeSource('value', { value: 1 })
    let protocol = getEventSourceProtocol(source)
    invariant(protocol)
    expect(protocol.type).toBe('value')
    invariant(protocol.read)
    expect(protocol.read()).toBe(1)
    expect(getEventSourceProtocol({})).toBe(undefined)
    expect(getEventSourceProtocol(null)).toBe(undefined)
  })
})
