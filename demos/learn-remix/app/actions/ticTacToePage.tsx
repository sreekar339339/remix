import { type Handle } from 'remix/ui'
import { Layout } from '../ui/layout.tsx'
import { TicTacToeCustomEvents } from '../assets/ticTacToe.tsx'

export function TicTacToePage(handle: Handle) {
  return () => (
    <Layout>
      <h1>Play Tic Tac Toe!</h1>
      {/* <TicTacToe /> */}
      <TicTacToeCustomEvents />
    </Layout>
  )
}
