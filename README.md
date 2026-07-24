# Foresight

Permissionless futarchy on Gnosis.

## Layout

| Path                      | Package                 | Purpose                                                                           |
| ------------------------- | ----------------------- | --------------------------------------------------------------------------------- |
| `apps/web`                | `web`                   | Participant UI — see [apps/web/README.md](apps/web/README.md)                     |
| `apps/devtools`           | `@foresight/devtools`   | Local dev tools                                                                   |
| `apps/subgraph/foresight` | `foresight-subgraph`    | Foresight indexer                                                                 |
| `apps/graph-node`         | `@foresight/graph-node` | Docker graph-node stack                                                           |
| `packages/contracts`      | `@foresight/contracts`  | SessionFactory — see [packages/contracts/README.md](packages/contracts/README.md) |

## Quick start

Requires Node 20+ and Yarn 4 (`corepack enable`).

```bash
yarn install
cp apps/web/.env.example apps/web/.env.local   # then fill it in
yarn dev                 # web at http://localhost:3000
```

The web app validates its environment at startup and refuses to boot without it - see
[apps/web/README.md](apps/web/README.md) for what each variable is.

Optional local indexer (separate terminals):

```bash
yarn local-node:contracts    # terminal 1: compile + hardhat node
yarn graph-node:up           # terminal 2: graph-node + ipfs + postgres
yarn deploy:subgraph         # terminal 3: deploy indexer to local graph-node
```

After **contract changes** while the node is still running: `yarn local-node:deploy` (redeploy + wagmi codegen).

See [packages/contracts/README.md](packages/contracts/README.md) for deploy, artifact exports, and subgraph ABI sync.

## Tests

```bash
yarn workspace @foresight/contracts test
yarn test:e2e
yarn format          # root files, then turbo per workspace
yarn format:check    # same, check only
```

## License

[MIT](./LICENSE) © Kleros
