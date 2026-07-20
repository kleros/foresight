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
├── components/   Shared UI used across features
├── config/       Env and constants (non-JSX)
├── features/     Feature modules — most code lives here
│   └── <feature>/
│       ├── api/          Data access for this feature
│       ├── components/
│       ├── hooks/
│       ├── stores/
│       ├── types/
│       ├── utils/        Pure functions — unit-test these
│       └── index.ts      Public API
├── hooks/        Shared hooks only
├── lib/          Preconfigured clients (HTTP, query, web3)
├── types/
└── utils/
```

## Rules

| Rule | Detail |
| ---- | ------ |
| Thin routes | Route files compose features and do little else — no data fetching or business logic inline |
| Feature public API | Import across features only through `features/<x>/index.ts`, never reach into internals |
| Logic out of components | Domain and math logic goes in `features/*/utils` or `lib/` so it tests without rendering; hooks wrap IO |
| Shared means shared | Something used by one feature belongs to that feature, not `components/` |
| No parallel layer schemes | Don't add `screens/`, `widgets/`, `entities/`, or a Pages-Router `pages/` alongside this structure |

## When reviewing

Check placement before logic. A file in the wrong layer is a problem that compounds — features that import each other's internals get hard to move or delete later.

If a feature has grown enough that its `index.ts` exports a dozen things, that's a signal it's really two features.
