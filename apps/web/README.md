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

## Commands

Run from the repo root (`yarn dev` starts this app), or from `apps/web`:

```bash
yarn dev            # http://localhost:3000
yarn build          # production build — also runs lint and type checks
yarn lint           # eslint, zero warnings tolerated
yarn check-types    # tsc --noEmit
yarn test:e2e       # playwright
```

## Code structure

Layout and placement rules — where a file goes, how routes compose features, why there are
no barrel files — live in one place:
[`.claude/skills/bulletproof-web/SKILL.md`](../../.claude/skills/bulletproof-web/SKILL.md).
Start at the "Where does this go?" section.

Two things it is worth knowing before reading code here:

- **Wallet providers are route-scoped.** `Web3Providers` (wagmi + AppKit + Atlas) is mounted
  in the `layout.tsx` of routes that need a wallet, not at the root, so pages that don't need
  a wallet never load it.
- **Imports flow `shared → features → app`**, enforced by `import-x/no-restricted-paths` in
  [`eslint.config.mjs`](eslint.config.mjs). A feature importing another feature fails lint.
