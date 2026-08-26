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
- `customEvents` owns event-aware views. `evented.<tag>` is a cached component that renders the matching intrinsic element and accepts selector(s) through `on`: `<evented.select on={[events.a, events.b]} value={(selectedId) => ...}>{([people, prefix]) => ...}</evented.select>`. Reactive props and `children` receive the selected value and matching event, the component subscribes only while mounted, and replacing `on` replaces its subscriptions. The wildcard form is `on={events.on['*']}`. Canonical components build state with `class X extends Events {}` plus `X.define()` (`class { fields; methods; constructor(api) { api.on.field(cb) } }`; the base carries only the static, so instance names never collide): the returned object is the pure event surface (no state names on it), with a native `EventTarget` channel; writes are `events.dispatchEvent({ fieldName: value } | 'notification')` (or a native `event`/`events.create({ name: detail })` on any target); methods are handlers that mutate an Immer draft of the state with path-based matching (external calls dispatch by name); `api.on.<field>(function ({ detail }) { this.x = ... })` registers effects (dispatch-only; deep paths via `api.on.columns.get(id)(cb)`), and `api.create` mirrors the descriptor's `create` so effects build hosted events (`target.dispatchEvent(api.create({ name: detail }))`) without closing over the instance; once a run's signal aborts, further `this`-writes are dropped while reads stay live; and reads happen only through subscribed elements (`evented.<tag>` with `on` selectors) or `events.details.<name>`. `.asHost()` is the element-host mixin and `.asHost(target)` bridges a domain `EventTarget`.
- Keyed collections render through a container element with a children function: keyed diffs apply adds, removals, and reorders in place with minimal DOM work. Descriptors route notifications by path in `app/assets/utils/customEvents/runtime.ts` (`notifyEntries`), so per-item elements (`events.on.items.get(id)`) re-render exactly the touched item while whole-key elements re-resolve.
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
