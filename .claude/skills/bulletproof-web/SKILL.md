---
name: bulletproof-web
description: Bulletproof React conventions for frontend apps in this repo. Use when creating, moving, or reviewing files in a frontend app — deciding folder placement, import paths, or how to compose a feature.
---

# Bulletproof React conventions

Frontend apps in this repo follow [Bulletproof React](https://github.com/alan2207/bulletproof-react). When you add or move a file, place it by these rules.

## Where does this go? (start here)

Ask in order — the first "yes" wins:

1. **Is it the page itself?** Its title, layout, tabs, CTA, empty state — meaningless on another URL. → `app/<route>/_components/`. Helpers used only by that screen live there too.
2. **Do two sibling routes under one segment need it?** → the parent segment's `_components/`, e.g. `app/settings/_components/`.
3. **Is it about one domain thing** — sessions, notifications — using that domain's data, types or vocabulary? → `features/<x>/`, in `api/`, `components/`, `hooks/`, `types/` or `utils/` by kind.
4. **Is it generic, or a wrapper over `lib`** (wallet, auth, a button)? → `components/`, `hooks/`, `utils/`. Subfolders group by kind of UI or technical concern, never by product domain.
5. **A second feature needs it?** Promote it down into a shared layer. Never import feature → feature.

The test for 1 vs 3: _move this UI to another page, or into a modal — does it still make sense unchanged?_ Yes → feature block. No → route component. Size doesn't decide it; a whole email-preferences panel is a feature block, a three-line tab shell is route chrome.

Three habits that keep this honest:

- **Import the file, not a barrel.** `@/features/x/components/Thing`, never `@/features/x`. Measured in this repo: importing one component through a two-export barrel cost **+51 kB** First Load, because Next treats every re-exported `"use client"` module as part of the route's client graph.
- **Promote on the second consumer, not the first.** For small things, duplication beats an early abstraction.
- **Link through `config/paths.ts`.** `paths.market.getHref(address)`, never ``href={`/market/${address}`}``. A route written into a component is a route that moves without it. New route, new entry there. `no-restricted-syntax` in the app's `eslint.config.mjs` rejects an `href` whose value starts with `/`, in a literal or a template; external URLs and variables are untouched, and programmatic navigation (`router.push`, `redirect`) is on you.

## Layout

```text
src/
├── app/          Routes and layouts — thin
│   └── <route>/
│       ├── page.tsx      Reads route params/searchParams, renders the composition
│       ├── layout.tsx    Shell and route-scoped providers
│       └── _components/  Route-only composition — underscore keeps it out of routing
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

Imports flow one way: **shared → features → app**. `import-x/no-restricted-paths` enforces it, discovering feature folders from disk. Each app opts in from its own flat config — `architectureConfig(import.meta.dirname)` in `eslint.config.mjs`, after `...nextJsConfig`. The app root is a required argument because every zone resolves against it: given the wrong root the rule matches nothing and reports clean while enforcing nothing.

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

### Where a screen lives

The route composes the features — that is the app layer's job. In the App Router that composition is split across the server/client boundary, which is what `_components/` exists for. It is not about how many features a route touches: upstream's `profile/_components/profile.tsx` pulls from a single feature, and the Vite reference app has no `_components` at all.

| Layer                      | Responsibility                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `app/<route>/page.tsx`     | Server: `metadata`, route params and `searchParams`, prefetch/dehydrate, auth gates. Renders one route component. |
| `app/<route>/_components/` | `"use client"` — the route's screen: its chrome and arrangement, stitching feature blocks together                |
| `features/<x>/components/` | The blocks themselves, and their domain logic — reusable across routes                                            |

Read `searchParams` in `page.tsx` and pass values down as props rather than reaching for `useSearchParams` below. The client hook only resolves after hydration, so a prerendered page paints its empty-param state first — an uncontrolled widget seeded from it will keep the wrong value.

`_components/` is app layer, so it may import features; features may never import it. The underscore keeps Next from treating the folder as a route.

**The test — move this UI to another page, or into a modal. Does it still make sense unchanged?**

Yes → feature block. No, because it _is_ the page (title, layout, tabs, CTA, empty state) → route `_components/`. Size is not the criterion: a whole email-preferences panel is a feature block, while a three-line tab shell is route chrome. When unsure which feature something belongs to, check what it imports — code that touches none of a feature's data or vocabulary belongs to no feature.

Don't call anything a "Screen". It isn't part of this vocabulary and it makes route arrangements look like feature exports. Name blocks for what they do (`SessionList`, `CreateSessionForm`), and name a route component after its route.

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

| Upstream                       | Here                                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| kebab-case files and folders   | PascalCase for component files (`ConnectWallet.tsx`), matching the Kleros codebases this mirrors      |
| App-wide providers at the root | Web3/Atlas providers are mounted per route in that route's `layout.tsx`, keeping them off other pages |

## When reviewing

Check placement before logic. A file in the wrong layer is a problem that compounds — features that import each other get hard to move or delete later, whether or not the import went through a public API.

Flag any new `index.ts` that only re-exports: it costs bundle size for no benefit, and it hides which module a route actually depends on.
