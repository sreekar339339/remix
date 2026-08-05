import { form, get, resource, route, put, resources, post, del } from 'remix/routes'

export const routes = route({
  assets: get('/assets/*path'),
  index: get('/'),
  ticTacToe: get('ticTacToe'),
  searchBooks: route('searchBooks', {
    withoutFrame: get('withoutFrame'),
    withFrame: get('withFrame'),
    books: get('books'),
  }),
  todolist: route('todolist', {
    index: get('/'),
    todos: form('todos'),
  }),
  kitchenSink: get('kitchenSink'),
  sevenGuis: get('sevenGuis'),
  kanban: get('kanban'),
})
