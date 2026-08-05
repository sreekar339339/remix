import { createController } from 'remix/router'
import { routes } from '../routes.ts'
import { TicTacToePage } from './ticTacToePage.tsx'
import { Index } from './index.tsx'
import { assetServer } from '../assets.ts'
import { match, P } from 'ts-pattern'
import * as s from 'remix/data-schema'
import { TodoListCustomEventsPage } from './todoListPage.tsx'
import { addTodos, deleteTodos, todos, updateTodos } from '../data/todolist.ts'
import { redirect } from 'remix/response/redirect'
import * as f from 'remix/data-schema/form-data'
import { maxLength, minLength } from 'remix/data-schema/checks'
import { TodoItemsClientEntryMarked as TodoItemsCustomEventsClientEntryMarked } from '../assets/todolist/todoItems.tsx'
import * as coerce from 'remix/data-schema/coerce'
import { SearchBooksWithoutFramePage } from './searchBooksWithoutFramePage.tsx'
import { SearchBooksWithFramePage } from './searchBooksWithFramePage.tsx'
import { KistchenSinkPage } from './kitchenSinkPage.tsx'
import { SevenGuisPage } from './sevenGuisPage.tsx'
import { KanbanPage } from './kanbanPage.tsx'

export const rootController = createController(routes, {
  actions: {
    ticTacToe({ render }) {
      return render(<TicTacToePage />)
    },
    index({ render, url }) {
      return render(<Index url={url} />)
    },
    async assets(context) {
      return (
        (await assetServer.fetch(context.request)) ?? new Response('Not Found', { status: 404 })
      )
    },
    kitchenSink({ render }) {
      return render(<KistchenSinkPage />)
    },
    sevenGuis({ render }) {
      return render(<SevenGuisPage />)
    },
    kanban({ render }) {
      return render(<KanbanPage />)
    },
  },
})

type SearchEvent =
  | { type: 'error'; error: Error }
  | { type: 'booksFound'; books: Array<{ title: string }> }
  | { type: 'booksNotFound'; reason: 'emptyList' | { other: string } }

const openLibrarySchema = s.union([
  s.object({
    docs: s.array(
      s.object({
        title: s.string(),
      }),
    ),
  }),
  s.object({
    detail: s.array(s.object({ msg: s.string() })),
  }),
])

export const searchBooksController = createController(routes.searchBooks, {
  actions: {
    withFrame({ render, url }) {
      const initialQuery = (url.searchParams.get('q') || '').trim()
      return render(<SearchBooksWithFramePage initialQuery={initialQuery} />)
    },
    withoutFrame({ url, render }) {
      const initialQuery = (url.searchParams.get('q') || '').trim()
      return render(<SearchBooksWithoutFramePage initialQuery={initialQuery} />)
    },
    async books({ render, url, headers }) {
      await delay(2000)
      const openLibraryUrl = new URL('https://openlibrary.org/search.json')
      openLibraryUrl.searchParams.set('q', (url.searchParams.get('q') || '').trim())
      openLibraryUrl.searchParams.set('limit', '20')
      let resp: Response
      try {
        resp = await fetch(openLibraryUrl)
        if (!resp.ok) {
          throw new Error(`${resp.status} ${resp.statusText}`, {
            cause: await resp.text(),
          })
        }
      } catch (error) {
        let error_ = error as Error
        return new Response(error_.message + 'cause: ' + error_.cause, {
          status: 500,
          statusText: error_.name,
        })
      }
      if (headers.get('Content-Type') === 'application/json') {
        return new Response(resp.body, {
          headers: {
            'Content-Type': 'application/json',
          },
        })
      }
      let searchEvent: SearchEvent
      try {
        let json = await resp.json()
        searchEvent = match(s.parse(openLibrarySchema, json))
          .returnType<SearchEvent>()
          .with({ detail: [P.select(), ...P.array()] }, ({ msg }) => ({
            type: 'booksNotFound',
            reason: { other: msg },
          }))
          .with({ docs: [] }, () => ({
            type: 'booksNotFound',
            reason: 'emptyList',
          }))
          .with({ docs: P.select() }, (books) => ({
            type: 'booksFound',
            books,
          }))
          .otherwise(() => ({
            type: 'booksNotFound',
            reason: { other: 'response shape mismatch' },
          }))
      } catch (error) {
        return match(error)
          .with(
            P.instanceOf(s.ValidationError),
            (error) =>
              new Response(error.issues[0].message, {
                status: 400,
                statusText: error.name,
              }),
          )
          .with(
            P.instanceOf(Error),
            (err) =>
              new Response(err.message + err.cause, {
                status: 500,
                statusText: err.name,
              }),
          )
          .otherwise(() => new Response('Unexpected server error', { status: 500 }))
      }

      return render(
        match(searchEvent)
          .with({ type: 'booksFound' }, ({ books }) => (
            <ul>
              {books.map((book) => (
                <li>{book.title}</li>
              ))}
            </ul>
          ))
          .with({ type: 'booksNotFound', reason: 'emptyList' }, () => (
            <p>Books not found for this title at this time.</p>
          ))
          .with({ type: 'booksNotFound', reason: { other: P.select() } }, (msg) => (
            <p>Could not fetch books. reason: {msg}.</p>
          ))
          .with({ type: 'error' }, ({ error }) => (
            <p>
              Unexpected error occured, try again! {error.message} {error.cause as string}
            </p>
          ))
          .exhaustive(),
      )
    },
  },
})

let delay = (ms = 1000) => new Promise((res) => setTimeout(res, ms))

export const todolistController = createController(routes.todolist, {
  actions: {
    index({ render }) {
      return render(<TodoListCustomEventsPage todos={todos} />)
    },
  },
})

const intent = {
  create: 'create',
  delete: 'delete',
  update: 'update',
  none: 'none',
} as const

const fields = {
  redirectTo: f.field(s.optional(s.literal(intent.none))),
  intent<T extends keyof typeof intent>(val: T) {
    return f.field(s.literal(val))
  },
  text: f.field(s.string().pipe(minLength(3), maxLength(100))),
  completed: f.field(coerce.boolean()),
  id: f.field(s.string()),
}

const todoActionFormData = s.union([
  f.object({
    intent: fields.intent('create'),
    text: fields.text,
    redirectTo: fields.redirectTo,
  }),
  f.object({
    intent: fields.intent('delete'),
    id: fields.id,
    redirectTo: fields.redirectTo,
  }),
  f.object({
    intent: fields.intent('update'),
    text: fields.text,
    id: fields.id,
    redirectTo: fields.redirectTo,
  }),
  f.object({
    intent: fields.intent('update'),
    completed: fields.completed,
    id: fields.id,
    redirectTo: fields.redirectTo,
  }),
])

export const todosCrudController = createController(routes.todolist.todos, {
  actions: {
    async index({ render }) {
      await delay(2000)
      return render(<TodoItemsCustomEventsClientEntryMarked todos={todos} />)
    },
    async action({ formData }) {
      await delay(2000)
      try {
        let input = s.parse(todoActionFormData, formData)
        match(input)
          .with(
            {
              intent: 'create',
              text: P.select(),
            },
            addTodos,
          )
          .with({ intent: 'delete', id: P.select() }, deleteTodos)
          .with({ intent: 'update' }, ({ intent, id, ...rest }) => {
            updateTodos(id, rest)
          })
          .exhaustive()
        if (input.redirectTo === 'none') {
          return new Response(null, { status: 204 })
        }
        return redirect(routes.todolist.index.href())
      } catch (e) {
        return match(e)
          .with(
            P.instanceOf(s.ValidationError),
            (error) =>
              new Response(error.issues[0].message, {
                status: 400,
                statusText: error.name,
              }),
          )
          .with(
            P.instanceOf(Error),
            (err) =>
              new Response(err.message + err.cause, {
                status: 500,
                statusText: err.name,
              }),
          )
          .otherwise(() => new Response('Unexpected server error', { status: 500 }))
      }
    },
  },
})
