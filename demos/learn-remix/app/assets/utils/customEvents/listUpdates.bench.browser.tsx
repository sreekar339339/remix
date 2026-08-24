import * as assert from 'remix/assert'
import { it } from 'remix/test'
import type { Handle } from 'remix/ui'
import { render } from 'remix/ui/test'
import { evented } from './index.tsx'

const itemCount = 1_000
const ops = 100

type Item = { id: number; label: string }

function seed() {
  let items = new Map<number, Item>()
  for (let index = 0; index < itemCount; index++) {
    items.set(index, { id: index, label: `item-${index}` })
  }
  return items
}

let settleCount = 0
async function settle() {
  settleCount++
  // The scheduler's cascading-update guard only resets on a macrotask, so
  // yield one periodically or long bursts of awaited updates trip it.
  if (settleCount % 40 === 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

/** Warms up every mutation path without changing the committed state. */
function warmup(add: (id: number) => void, remove: (id: number) => void) {
  for (let index = 0; index < 5; index++) add(itemCount + index)
  for (let index = 0; index < 5; index++) remove(itemCount + index)
  for (let index = 0; index < 5; index++) remove(itemCount - 1 - index)
  for (let index = 0; index < 5; index++) add(itemCount - 5 + index)
}

function observeMutations(node: Node) {
  let childList = 0
  let characterData = 0
  let observer = new MutationObserver((mutations) => {
    for (let mutation of mutations) {
      if (mutation.type === 'characterData') characterData++
      else childList++
    }
  })
  observer.observe(node, { childList: true, characterData: true, subtree: true })
  return {
    counts: () => ({ childList, characterData }),
    disconnect: () => observer.disconnect(),
  }
}

/**
 * Times one phase run, asserts the resulting DOM, resets to the committed
 * state, then repeats the identical run under a mutation observer. Template
 * calls are counted during the observed run only.
 */
async function timeAndCount(
  run: () => Promise<void>,
  section: HTMLElement,
  reset: () => Promise<void>,
  assertAfterRun: () => void,
  templateCalls: () => number,
) {
  await reset()

  let started = performance.now()
  await run()
  let duration = performance.now() - started

  assertAfterRun()

  await reset()

  let observer = observeMutations(section)
  let templateBaseline = templateCalls()
  await run()
  let mutations = observer.counts()
  observer.disconnect()

  return { duration, mutations, templates: templateCalls() - templateBaseline }
}

function report(
  scenario: string,
  phase: string,
  duration: number,
  mutations: { childList: number; characterData: number },
  templates: number,
) {
  console.log(
    `[list updates ${scenario} ${phase}] ${JSON.stringify({
      operations: ops,
      durationMs: Number(duration.toFixed(2)),
      averageOpMs: Number((duration / ops).toFixed(4)),
      childListMutationsPerOp: Number((mutations.childList / ops).toFixed(1)),
      characterDataMutationsPerOp: Number((mutations.characterData / ops).toFixed(1)),
      templateRunsPerOp: Number((templates / ops).toFixed(2)),
    })}`,
  )
}

it('benchmarks plain keyed map re-renders', async (t) => {
  let items = seed()
  let templateCalls = 0
  let update: () => void = () => {}
  let nextId = itemCount
  let frontId = 0
  let middleId = 500

  function PlainList(handle: Handle) {
    update = handle.update
    return () => (
      <section className="host">
        {items
          .values()
          .map((item) => {
            templateCalls++
            return (
              <div key={item.id} className="item">
                {item.label}
              </div>
            )
          })
          .toArray()}
      </section>
    )
  }

  let result = render(<PlainList />)
  t.after(() => result.cleanup())
  let section = result.$('.host')!

  let addPhase = async () => {
    for (let index = 0; index < ops; index++) {
      let id = nextId++
      items.set(id, { id, label: `item-${id}` })
      update()
      await settle()
    }
  }
  let removeFrontPhase = async () => {
    for (let index = 0; index < ops; index++) {
      items.delete(frontId++)
      update()
      await settle()
    }
  }
  let removeMiddlePhase = async () => {
    for (let index = 0; index < ops; index++) {
      items.delete(middleId + index)
      update()
      await settle()
    }
  }

  let committed = new Map(items)
  let reset = async () => {
    nextId = itemCount
    frontId = 0
    middleId = 500
    items = new Map(committed)
    update()
    await settle()
  }

  assert.equal(section.querySelectorAll('.item').length, itemCount)

  warmup(
    (id) => {
      items.set(id, { id, label: `item-${id}` })
      update()
    },
    (id) => {
      items.delete(id)
      update()
    },
  )
  await settle()

  let items$ = () => section.querySelectorAll('.item')

  let adds = await timeAndCount(
    addPhase,
    section,
    reset,
    () => {
      assert.equal(items$().length, itemCount + ops)
      assert.equal(items$()[0].textContent, 'item-0')
      assert.equal(items$()[items$().length - 1].textContent, `item-${itemCount + ops - 1}`)
    },
    () => templateCalls,
  )
  report('keyed', 'append', adds.duration, adds.mutations, adds.templates)

  let frontRemovals = await timeAndCount(
    removeFrontPhase,
    section,
    reset,
    () => {
      assert.equal(items$().length, itemCount - ops)
      assert.equal(items$()[0].textContent, `item-${ops}`)
    },
    () => templateCalls,
  )
  report(
    'keyed',
    'remove-front',
    frontRemovals.duration,
    frontRemovals.mutations,
    frontRemovals.templates,
  )

  let middleRemovals = await timeAndCount(
    removeMiddlePhase,
    section,
    reset,
    () => {
      assert.equal(items$().length, itemCount - ops)
      assert.equal(items$()[middleId].textContent, `item-${middleId + ops}`)
    },
    () => templateCalls,
  )
  report(
    'keyed',
    'remove-middle',
    middleRemovals.duration,
    middleRemovals.mutations,
    middleRemovals.templates,
  )
})

it('benchmarks plain unkeyed re-renders', async (t) => {
  let items = seed()
  let templateCalls = 0
  let update: () => void = () => {}
  let nextId = itemCount
  let frontId = 0
  let middleId = 500

  function PlainList(handle: Handle) {
    update = handle.update
    return () => (
      <section className="host">
        {items
          .values()
          .map((item) => {
            templateCalls++
            return <div className="item">{item.label}</div>
          })
          .toArray()}
      </section>
    )
  }

  let result = render(<PlainList />)
  t.after(() => result.cleanup())
  let section = result.$('.host')!

  let addPhase = async () => {
    for (let index = 0; index < ops; index++) {
      let id = nextId++
      items.set(id, { id, label: `item-${id}` })
      update()
      await settle()
    }
  }
  let removeFrontPhase = async () => {
    for (let index = 0; index < ops; index++) {
      items.delete(frontId++)
      update()
      await settle()
    }
  }
  let removeMiddlePhase = async () => {
    for (let index = 0; index < ops; index++) {
      items.delete(middleId + index)
      update()
      await settle()
    }
  }

  let committed = new Map(items)
  let reset = async () => {
    nextId = itemCount
    frontId = 0
    middleId = 500
    items = new Map(committed)
    update()
    await settle()
  }

  assert.equal(section.querySelectorAll('.item').length, itemCount)

  warmup(
    (id) => {
      items.set(id, { id, label: `item-${id}` })
      update()
    },
    (id) => {
      items.delete(id)
      update()
    },
  )
  await settle()

  let items$ = () => section.querySelectorAll('.item')

  let adds = await timeAndCount(
    addPhase,
    section,
    reset,
    () => {
      assert.equal(items$().length, itemCount + ops)
      assert.equal(items$()[0].textContent, 'item-0')
      assert.equal(items$()[items$().length - 1].textContent, `item-${itemCount + ops - 1}`)
    },
    () => templateCalls,
  )
  report('unkeyed', 'append', adds.duration, adds.mutations, adds.templates)

  let frontRemovals = await timeAndCount(
    removeFrontPhase,
    section,
    reset,
    () => {
      assert.equal(items$().length, itemCount - ops)
      assert.equal(items$()[0].textContent, `item-${ops}`)
    },
    () => templateCalls,
  )
  report(
    'unkeyed',
    'remove-front',
    frontRemovals.duration,
    frontRemovals.mutations,
    frontRemovals.templates,
  )

  let middleRemovals = await timeAndCount(
    removeMiddlePhase,
    section,
    reset,
    () => {
      assert.equal(items$().length, itemCount - ops)
      assert.equal(items$()[middleId].textContent, `item-${middleId + ops}`)
    },
    () => templateCalls,
  )
  report(
    'unkeyed',
    'remove-middle',
    middleRemovals.duration,
    middleRemovals.mutations,
    middleRemovals.templates,
  )
})
