# Tic Tac Toe Agent Guide

Remix 3 demo app living inside the remix monorepo at `demos/learn-remix`. It depends on `remix` via `workspace:*`, so every `remix/*` import resolves to the repo's `packages/*/src` source directly — edits to `packages/ui` (or any package) take effect immediately with no install, build, or patch step. For full Remix conventions (architecture, controllers, middleware, validation, auth, testing), read `./.agents/skills/remix/SKILL.md` before building features.

## Commands

Package manager is **pnpm**. Run everything from the monorepo root or with `-C demos/learn-remix`; dependencies are installed by the root `pnpm install`.

```sh
pnpm -C demos/learn-remix run dev        # NODE_ENV=development, node --watch, source runs directly (no build step)
pnpm -C demos/learn-remix run start      # NODE_ENV=production
pnpm -C demos/learn-remix test           # NODE_ENV=test remix test — runs BOTH server and browser suites
pnpm -C demos/learn-remix run typecheck  # tsc --noEmit
pnpm -C demos/learn-remix run benchmark:custom-events
```

- No `lint` and no `build` scripts exist. Do not invent them.
- Requires Node >= 24.3.0; server listens on `PORT` (default 44100).
- `remix test` discovers `**/*.test.tsx`. Run one file with `NODE_ENV=test remix test "app/assets/<file>.test.tsx"` from `demos/learn-remix`.
- Browser tests run Chromium only (see `playwright.config.ts`); several tests assert Chromium-specific focus behavior.

## Testing Conventions

- `*.test.tsx` = server/SSR tests (use `renderToString` from `remix/ui/server`); `*.test.browser.tsx` = real-browser DOM tests (Playwright; `render` from `remix/ui/test` + `result.act()`).
- All tests currently live in `app/assets/`; the repo has no `app/actions` or `router.fetch` tests yet. Prefer `router.fetch(new Request(...))` for controller/router behavior (see SKILL).
- Component tests only for DOM-specific behavior; test HTTP routes at the server layer.

## Remix Quirks (non-React)

- Import only from `remix/<subpath>` (`remix/router`, `remix/ui`, `remix/test`, ...). There is no top-level `remix` import.
- UI components are **not React**: they receive a `handle`, read `handle.props`, and return a zero-arg render function. `jsxImportSource` is `remix/ui`.
- Host elements are event-aware via the `eventSource` prop (`packages/ui/src/runtime/event-source.ts`): `<select eventSource={[events.a, events.b]} value={({detail}) => ...}>{({detail}) => ...}</select>`. Any prop and `children` may be a function of the event input; the element re-renders through the vdom on matched events. `app/assets/utils/customEvents/` sources implement the protocol, and `evented.<tag>` is a type-only intrinsic alias (`evented.button` is the string `'button'` at runtime) that preserves typed callback inference over `eventSource`, inferring the event map from the descriptor passed as `eventSource`; the descriptor itself is the explicit wildcard source (`eventSource={events}`).
- Keyed collections render through the `evented.list` intrinsic (`packages/ui/src/runtime/event-route.ts`): one state source, a per-item `(item, key) =>` template. The store attaches structural routes (`EVENT_ROUTES`) to dispatched events in `app/assets/utils/customEvents/runtime.ts` (`notifyEntries`), so adds, removals, and Map value replaces apply fine-grained while whole-key changes reconcile through the keyed diff.
- `app/routes.ts` is the source of truth for URLs; use `routes.<name>.href(...)` for links/redirects/tests. Controllers return explicit `Response` objects; validate at boundaries with `remix/data-schema`.

## Layout

- `app/actions/controller.tsx` owns route actions (currently all controllers, incl. the nested `todolist` map). `app/routes.ts` = route contract. `app/router.ts` = middleware (`staticFiles`, `formData`, `render`) + explicit `router.map(...)`. `app/middleware/render.tsx` = request-scoped renderer. `app/ui/` = shared shell/layout. `app/assets.ts` = server asset pipeline rooted at the monorepo root: serves `demos/learn-remix/app/**` under `/app/*`, repo package sources under `/packages/*`, and npm deps under `/node_modules/*` (`allowFiles` + `allowPackages` control access).
- Client/browser code lives in `app/assets/` (entry.ts boots via `remix/ui` `run`). `app/data/todolist.ts` is an in-memory store; no DB yet (`.gitignore` anticipates `db/*.sqlite`).
- No env files/dotenv — `NODE_ENV` is set inline per script; `PORT` read in `server.ts`.

## Route Ownership

- Start from `app/routes.ts` and map each route to the narrowest owner on disk.
- Top-level route actions go in `app/actions/controller.tsx`; add `app/actions/<route-key>/controller.tsx` for nested route maps that need their own actions or middleware.
- Keep route-owned page modules next to the route that owns them; move shared UI to `app/ui/`.
- Avoid generic dumping grounds (`app/lib/`, `app/components/`); prefer narrow owners.

## Conventions

- Git commits: single-line, lowercase, informal subjects, no conventional-commit prefixes (e.g. `refactor`, `api signature change`, `optimisations`).
