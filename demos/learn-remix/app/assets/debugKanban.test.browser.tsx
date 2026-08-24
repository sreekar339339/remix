import { it } from 'remix/test'
import * as assert from 'remix/assert'
import { render } from 'remix/ui/test'
import { Events, evented } from './utils/customEvents/index.tsx'

function initialColumns() {
  return new Map<string, string>([['a', 'X']])
}

it('debug kanban variants', async (t) => {
  class K extends Events {
    columns = initialColumns()
  }
  let events = K.define()

  function VariantTuple() {
    return () => (
      <evented.section on={[events.on.columns]}>
        {(columns) => <>TUPLE:{columns?.entries().next().value?.[0] ?? 'none'}</>}
      </evented.section>
    )
  }
  function VariantWildcard() {
    return () => (
      <evented.section on={events.on['*']}>
        {(current) => <>WILD:{current.columns?.entries().next().value?.[0] ?? 'none'}</>}
      </evented.section>
    )
  }
  function VariantSingle() {
    return () => (
      <evented.section on={events.on.columns}>
        {(columns) => <>SINGLE:{columns?.entries().next().value?.[0] ?? 'none'}</>}
      </evented.section>
    )
  }

  let a = render(<VariantTuple />)
  t.after(() => a.cleanup())
  let b = render(<VariantWildcard />)
  t.after(() => b.cleanup())
  let c = render(<VariantSingle />)
  t.after(() => c.cleanup())

  assert.equal(a.container.textContent, 'TUPLE:a')
  assert.equal(b.container.textContent, 'WILD:a')
  assert.equal(c.container.textContent, 'SINGLE:a')
})