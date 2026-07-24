---
name: bulletproof-web
description: Bulletproof React conventions for frontend apps in this repo. Use when creating, moving, or reviewing files in a frontend app — deciding folder placement, import paths, or how to compose a feature.
---

# Bulletproof React conventions

Frontend apps in this repo follow [Bulletproof React](https://github.com/alan2207/bulletproof-react). When you add or move a file, place it by these rules.

## Layout

```text
src/
├── app/          Routes and layouts — thin
├── assets/       Static files: images, icons, fonts
├── components/   Shared UI used across features (ui/ for primitives)
├── config/       Env, constants, route paths (non-JSX)
├── features/     Feature modules — most code lives here
│   └── <feature>/
│       ├── api/          Requests + their query/mutation hooks, one file per request
│       ├── assets/
│       ├── components/
│       ├── hooks/
│       ├── stores/
│       ├── types/
│       └── utils/        Pure functions — unit-test these
├── hooks/        Shared hooks only
├── lib/          Preconfigured clients (HTTP, query, web3, auth)
├── stores/       Global state
├── types/
└── utils/
```

## Layering

Imports flow one way: **shared → features → app**. `import-x/no-restricted-paths` in `@foresight/eslint-config/next-js` enforces it, discovering feature folders from disk.

| Rule                      | Detail                                                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Thin routes               | Route files compose features and do little else — no data fetching or business logic inline                                |
| No cross-feature imports  | A feature never imports another feature. Routes compose features; that is the only place two features meet                 |
| Promote, don't cross-link | When a second feature needs something, move it into a shared layer and both import it downward. Never sideways             |
| Shared knows nothing      | `components/`, `hooks/`, `lib/`, `utils/`, `config/` must not import from `features/` or `app/` — they stay reusable alone |
| Shared means shared       | Something used by one feature belongs to that feature, not `components/`. Promote on the second consumer, not the first    |
| Logic out of components   | Domain and math logic goes in `features/*/utils` or `lib/` so it tests without rendering; hooks wrap IO                    |
| No parallel layer schemes | Don't add `screens/`, `widgets/`, `entities/`, or a Pages-Router `pages/` alongside this structure                         |

Features are **domain modules**, not routes. `features/markets`, not `features/create`. One route may compose several features, and one feature may serve several routes.

## Data and state

| Concern         | Where it goes                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------ |
| API client      | One preconfigured instance in `lib/` — never construct clients at call sites                                 |
| Requests        | `features/<x>/api/<verb>-<noun>.ts`: the fetcher, its types, and the react-query hook, colocated in one file |
| Server cache    | react-query. Never mirror server data into a global store                                                    |
| Component state | `useState`/`useReducer`, as close to use as possible. Lift only when a sibling needs it                      |
| Global state    | Only genuinely app-wide concerns (theme, session). Resist premature globalisation                            |
| Form state      | A form library + schema validation, wrapped in shared form components                                        |
| URL state       | Route params and search params — the source of truth for anything shareable or bookmarkable                  |

Type every response and infer downstream, so a schema change surfaces as type errors rather than runtime surprises.

## Components

- Extract UI units into components rather than nested render functions inside a component.
- Colocate: keep components, styles, and state next to where they're used, and move them up only when a second consumer appears.
- Watch prop count. Many props means the component wants splitting, or composition through `children`/slots.
- Wrap third-party components so the app depends on your interface, not theirs.
- Don't abstract on the first repetition — wait until the pattern is real, or you'll abstract the wrong thing.

## Errors, performance, testing

- Multiple error boundaries, one per meaningful region — not a single boundary at the root.
- Handle API failures centrally (toast, sign-out on 401) rather than at each call site.
- Split code at route level. Lazy-load what's off-screen; don't split so finely that request overhead dominates.
- Pass JSX through `children` to keep parents from re-rendering their subtree.
- Integration tests over unit tests for confidence; test what a user sees, not implementation details. Colocate as `__tests__/`.

## This repo's deliberate deviations

| Upstream                       | Here                                                                                                                                                                                                                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| kebab-case files and folders   | PascalCase for component files (`ConnectWallet.tsx`), matching the Kleros codebases this mirrors                                                                                                                                                                                             |
| No barrel files                | A thin `features/<x>/index.ts` is the route-facing API — route entry points only, never a re-export dump. Upstream's warning is about Vite dev-mode and large barrels; a one-or-two-export barrel is an alias. Aggregate barrels (`components/index.ts` re-exporting everything) stay banned |
| App-wide providers at the root | Web3/Atlas providers are mounted per route in that route's `layout.tsx`, keeping them off other pages                                                                                                                                                                                        |

## When reviewing

Check placement before logic. A file in the wrong layer is a problem that compounds — features that import each other get hard to move or delete later, whether or not the import went through a public API.

If a feature's `index.ts` exports a dozen things, that's a signal it's really two features.
