import { expect } from '@remix-run/assert'
import { describe, it } from '@remix-run/test'

import { createRoot } from '../runtime/vdom.ts'
import { invariant } from '../runtime/invariant.ts'
import { renderToString } from '../server/stream.ts'
import {
  EVENT_ROUTES,
  EVENT_SOURCE,
  type EventRoutes,
  type EventSource,
  type EventSourceEvent,
} from '../index.ts'

type FakeListSource<Value> = EventSource & {
  fire(detail: Value, routes?: EventRoutes): void
  subscriberCount(): number
}

function createFakeListSource<Value>(initial: Value): FakeListSource<Value> {
  let target = new EventTarget()
  let value = initial
  let subscribers = 0
  return {
    [EVENT_SOURCE]: {
      type: 'items',
      read: () => value,
      subscribe(subscriber, signal) {
        subscribers++
        let listener = (event: Event) => subscriber.notify(event as EventSourceEvent)
        target.addEventListener('items', listener)
        signal.addEventListener('abort', () => {
          subscribers--
          target.removeEventListener('items', listener)
        })
      },
    },
    fire(detail, routes) {
      value = detail
      let event = new CustomEvent('items', { detail: detail ?? null })
      if (routes) {
        Object.defineProperty(event, EVENT_ROUTES, { configurable: true, value: routes })
      }
      target.dispatchEvent(event)
    },
    subscriberCount() {
      return subscribers
    },
  }
}

function listItems(container: ParentNode): HTMLLIElement[] {
  return [...container.querySelectorAll('li')]
}

describe('list eventSource', () => {
  it('renders Map collections and applies fine-grained insert/remove/rebuild routes', (t) => {
    let source = createFakeListSource(
      new Map([
        ['a', 'Alpha'],
        ['b', 'Beta'],
      ]),
    )
    let container = document.createElement('div')
    let root = createRoot(container)
    t.after(() => root.dispose())
    root.render(
      <ul>
        <list eventSource={source}>{(item, key) => <li key={key}>{item as string}</li>}</list>
      </ul>,
    )
    root.flush()

    let items = () => listItems(container)
    expect(items().length).toBe(2)
    let first = items()[0]
    expect(first.textContent).toBe('Alpha')

    source.fire(
      new Map([
        ['a', 'Alpha'],
        ['b', 'Beta'],
        ['c', 'Gamma'],
      ]),
      { addresses: [['c']], ops: ['add'] },
    )
    root.flush()
    expect(items().length).toBe(3)
    expect(items()[0]).toBe(first)
    expect(items()[2].textContent).toBe('Gamma')

    source.fire(
      new Map([
        ['a', 'Alpha'],
        ['c', 'Gamma'],
      ]),
      { addresses: [['b']], ops: ['remove'] },
    )
    root.flush()
    expect(items().length).toBe(2)
    expect(items()[0]).toBe(first)
    expect(items()[1].textContent).toBe('Gamma')

    source.fire(
      new Map([
        ['a', 'ALPHA'],
        ['c', 'Gamma'],
      ]),
      { addresses: [['a']], ops: ['replace'] },
    )
    root.flush()
    expect(items().length).toBe(2)
    expect(items()[0]).toBe(first)
    expect(items()[0].textContent).toBe('ALPHA')

    expect(source.subscriberCount()).toBe(1)
  })

  it('reconciles whole-key changes through the keyed diff', (t) => {
    let source = createFakeListSource(
      new Map([
        ['a', 'Alpha'],
        ['b', 'Beta'],
        ['c', 'Gamma'],
      ]),
    )
    let container = document.createElement('div')
    let root = createRoot(container)
    t.after(() => root.dispose())
    root.render(
      <ul>
        <list eventSource={source}>
          {(item, key) => (
            <li key={key}>
              <input defaultValue={item as string} />
            </li>
          )}
        </list>
      </ul>,
    )
    root.flush()

    let items = () => listItems(container)
    let kept = items()[1]
    let keptInput = kept.querySelector('input')
    invariant(keptInput)

    source.fire(
      new Map([
        ['b', 'BETA'],
        ['d', 'Delta'],
      ]),
      { addresses: [[]], ops: ['replace'] },
    )
    root.flush()
    expect(items().length).toBe(2)
    // The retained key keeps both its DOM node and its input state.
    expect(items()[0]).toBe(kept)
    expect(keptInput).toBe(items()[0].querySelector('input'))
    let addedInput = items()[1].querySelector('input')
    invariant(addedInput)
    expect(addedInput.value).toBe('Delta')
  })

  it('falls back to a full re-resolve when no routes are carried', (t) => {
    let source = createFakeListSource(['a', 'b'])
    let container = document.createElement('div')
    let root = createRoot(container)
    t.after(() => root.dispose())
    root.render(
      <ul>
        <list eventSource={source}>{(item, key) => <li key={key}>{item as string}</li>}</list>
      </ul>,
    )
    root.flush()

    let items = () => listItems(container)
    let first = items()[0]
    source.fire(['a', 'b', 'c'])
    root.flush()
    expect(items().length).toBe(3)
    expect(items()[0]).toBe(first)
  })

  it('applies array pushes, pops, and delete-by-id removes fine-grained', (t) => {
    let source = createFakeListSource(['a', 'b', 'c'])
    let container = document.createElement('div')
    let root = createRoot(container)
    t.after(() => root.dispose())
    root.render(
      <ul>
        <list eventSource={source}>{(item, key) => <li key={key}>{item as string}</li>}</list>
      </ul>,
    )
    root.flush()

    let items = () => listItems(container)
    let first = items()[0]

    source.fire(['a', 'b', 'c', 'd'], { addresses: [['3']], ops: ['add'] })
    root.flush()
    expect(items().length).toBe(4)
    expect(items()[0]).toBe(first)
    expect(items()[3].textContent).toBe('d')

    source.fire(['a', 'b', 'c'], { addresses: [['2']], ops: ['remove'] })
    root.flush()
    expect(items().length).toBe(3)
    expect(items()[0]).toBe(first)

    // Deleting the middle item shifts the tail: replace [1]=c, remove [2].
    source.fire(['a', 'c'], { addresses: [['1'], ['2']], ops: ['replace', 'remove'] })
    root.flush()
    expect(items().length).toBe(2)
    expect(items()[0]).toBe(first)
    expect(items()[1].textContent).toBe('c')
  })

  it('tears down its subscription when removed', (t) => {
    let source = createFakeListSource(
      new Map([
        ['a', 'Alpha'],
        ['b', 'Beta'],
      ]),
    )
    let container = document.createElement('div')
    let root = createRoot(container)
    t.after(() => root.dispose())
    root.render(
      <ul>
        <list eventSource={source}>{(item, key) => <li key={key}>{item as string}</li>}</list>
      </ul>,
    )
    root.flush()
    expect(source.subscriberCount()).toBe(1)

    root.render(<div />)
    root.flush()
    expect(source.subscriberCount()).toBe(0)
  })

  it('renders list children into parent markup on the server', async () => {
    let source = createFakeListSource(
      new Map([
        ['a', 'Alpha'],
        ['b', 'Beta'],
      ]),
    )
    let html = await renderToString(
      <ul>
        <list eventSource={source}>{(item, key) => <li key={key}>{item as string}</li>}</list>
      </ul>,
    )
    expect(html).toBe('<ul><li>Alpha</li><li>Beta</li></ul>')
  })
})
