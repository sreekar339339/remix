import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'
import { renderToString } from 'remix/ui/server'

import { TicTacToeCustomEvents } from './ticTacToe.tsx'

describe('TicTacToeCustomEvents SSR', () => {
  it('server-renders lexical function children from a state event', async () => {
    let html = await renderToString(<TicTacToeCustomEvents />)

    assert.match(html, /Game in progress/)
  })
})
