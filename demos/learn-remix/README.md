# Learn Remix

A Remix UI playground and experiment bench living inside the remix monorepo. It demonstrates event-driven UI patterns on top of `remix/ui`: a tic-tac-toe game, a kanban board, the [7GUIs](https://eugenkiss.github.io/7guis/tasks) tasks, and a `customEvents` library (`app/assets/utils/customEvents/`) that layers Immer-backed evented state, addressable event sources, and event-aware elements onto Remix element lifecycles.

Because this demo depends on `remix` via `workspace:*`, every `remix/*` import resolves straight to `packages/*/src` — editing any Remix package source takes effect immediately, which makes this demo a convenient harness for developing Remix UI itself.

## Running Locally

Dependencies are installed from the monorepo root (`pnpm install`). Then:

```sh
pnpm -C demos/learn-remix run dev    # dev server on http://localhost:44100
pnpm -C demos/learn-remix test       # server + browser test suites
pnpm -C demos/learn-remix run typecheck
```

## Shape

- `app/routes.ts` defines the route contract.
- `app/actions/controller.tsx` owns the top-level route actions.
- `app/router.ts` wires middleware (`staticFiles`, `formData`, `render`) and routes.
- `app/middleware/render.tsx` installs the request-scoped renderer used by actions.
- `app/ui/` holds the shared document shell and layout.
- `app/assets.ts` owns the asset pipeline, rooted at the monorepo root so workspace package sources are served under `/packages/*` and app modules under `/app/*`.
- `app/assets/` holds the browser code, including the `customEvents` experiments and their tests.
- `public/` contains static files served from the app root.
