import { css, type Handle, type RemixNode } from 'remix/ui'
import { Document } from './document.tsx'
import { routes } from '../routes.ts'

export function Layout(handle: Handle<{ children: RemixNode; url?: URL; params?: {} }>) {
  return () => (
    <Document>
      <main
        mix={css({
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        })}
      >
        <nav
          mix={css({
            display: 'flex',
            flexDirection: handle.props.url?.pathname === routes.index.href() ? 'column' : 'row',
            gap: 18,
            padding: 16,
            alignItems: 'center',
          })}
        >
          <a href={routes.index.href()}>Home</a>
          <a href={routes.ticTacToe.href()}>Tic Tac Toe</a>
          <a href={routes.searchBooks.withoutFrame.href()}>Search books without Frame</a>
          <a href={routes.searchBooks.withFrame.href()}>Search books with Frame</a>
          <a href={routes.todolist.index.href()}>Todo list</a>
          <a href={routes.sevenGuis.href()}>7GUIs</a>
          <a href={routes.kanban.href()}>Kanban experiment</a>
          <a href={routes.listUpdates.href()}>List updates</a>
          <a href={routes.jobRunner.href()}>Job runner</a>
        </nav>
        <section mix={css({ maxWidth: '70%' })}>{handle.props.children}</section>
      </main>
    </Document>
  )
}
