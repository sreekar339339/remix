import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { renderToString } from 'remix/ui/server'
import { TodoItems } from './todoItems.tsx'

describe('TodoItems SSR', () => {
  it('server-renders completed state in the customEvents copy', async () => {
    let html = await renderToString(
      <TodoItems
        todos={[
          {
            id: 'completed',
            completed: true,
            text: 'Done',
          },
        ]}
      />,
    )

    assert.match(html, /✓/)
  })
})
