# web

Participant UI for Foresight - Next.js 14 (App Router), Tailwind 4, and the
[Kleros UI components library](https://github.com/kleros/ui-components-library).

Wallet connection is wagmi v3 + [Reown AppKit](https://reown.com/appkit); sign-in and email
notifications go through Kleros Atlas via
[`@kleros/kleros-app`](https://github.com/kleros/kleros-v2/tree/master/kleros-app).

## Environment

Copy `.env.example` to `.env.local` and fill it in. Every variable is validated once at
module load by [`src/config/env.ts`](src/config/env.ts), so a missing or malformed value
fails the build with the offending names rather than at runtime.

| Variable                       | Required | Notes                                                                  |
| ------------------------------ | -------- | ---------------------------------------------------------------------- |
| `NEXT_PUBLIC_REOWN_PROJECT_ID` | yes      | Create a project at [dashboard.reown.com](https://dashboard.reown.com) |
| `NEXT_PUBLIC_ATLAS_URI`        | yes      | Atlas **origin** only - kleros-app appends `/graphql`.                 |
| `NEXT_PUBLIC_GNOSIS_RPC`       | no       | Preferred Gnosis RPC. Falls back to public endpoints                   |
| `NEXT_PUBLIC_SITE_URL`         | no       | Absolute URL used for metadata and the wallet modal                    |
| `NEXT_PUBLIC_SUBGRAPH_URL`     | yes      | Indexer GraphQL endpoint. Locally `http://localhost:8080/v1/graphql`   |

## Commands

Run from the repo root (`yarn dev` starts this app), or from `apps/web`:

```bash
yarn dev            # http://localhost:3000
yarn build          # production build, also runs lint and type checks
yarn lint           # eslint, zero warnings tolerated
yarn check-types    # tsc --noEmit
yarn codegen        # types for the indexer queries, needs a running indexer
yarn test:e2e       # playwright
```

## Indexer queries

Queries go through [`src/lib/graphql/batcher.ts`](src/lib/graphql/batcher.ts), which collapses
everything asked for within 100ms into a single request. Use `fetchGraphql` as a react-query
`queryFn`.

### Generating types

Query types live in `src/lib/graphql/generated/` and **are committed**, so CI and a fresh clone
need nothing running. After adding or changing a query, regenerate and commit:

```bash
yarn local-stack        # codegen reads the schema from a live indexer
yarn codegen
```

Codegen reads the same `NEXT_PUBLIC_SUBGRAPH_URL` the app queries at runtime.

When a second endpoint is added, give each its own `generates` entry with its own schema and
documents. Merging schemas would let a query mix fields from two endpoints and typecheck, which
no single request can answer.

## Code structure

Where a file goes, how routes compose features, why there are no barrel files: all of it
lives in [`.claude/skills/bulletproof-web/SKILL.md`](../../.claude/skills/bulletproof-web/SKILL.md).
Start at the "Where does this go?" section.

Two things it is worth knowing before reading code here:

- **Wallet providers are route-scoped.** `Web3Providers` (wagmi + AppKit + Atlas) is mounted
  in the `layout.tsx` of routes that need a wallet, not at the root, so pages that don't need
  a wallet never load it.
- **Imports flow `shared → features → app`**, enforced by `import-x/no-restricted-paths` in
  [`eslint.config.mjs`](eslint.config.mjs). A feature importing another feature fails lint.
