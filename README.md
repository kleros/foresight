# Foresight

Permissionless futarchy on Gnosis.

## Layout

| Path                 | Package                | Purpose                                                                           |
| -------------------- | ---------------------- | --------------------------------------------------------------------------------- |
| `apps/web`           | `web`                  | Participant UI — see [apps/web/README.md](apps/web/README.md)                     |
| `apps/devtools`      | `@foresight/devtools`  | Local dev tools                                                                   |
| `apps/indexer`       | `foresight-indexer`    | Envio indexer — see [apps/indexer/README.md](apps/indexer/README.md)              |
| `packages/contracts` | `@foresight/contracts` | SessionFactory — see [packages/contracts/README.md](packages/contracts/README.md) |

## Quick start

Requires Node 22+ and Yarn 4 (`corepack enable`). The indexer needs [Docker](https://www.docker.com/products/docker-desktop/).

```bash
yarn install
cp apps/web/.env.example apps/web/.env.local   # then fill it in
yarn dev                 # web at http://localhost:3000
```

The web app validates its environment at startup and refuses to boot without it - see
[apps/web/README.md](apps/web/README.md) for what each variable is.

The whole local stack, hardhat node, indexer and web, in one tmux session:

```bash
yarn local-stack         # start (wipes local deployments + indexed data)
yarn stop-local-stack    # stop stack
```

Or the same pieces by hand, in separate terminals:

```bash
yarn local-node:contracts    # terminal 1: compile + hardhat node
yarn indexer:dev             # terminal 2: envio indexer + hasura on :8080
```

After **contract changes** while the node is still running: `yarn local-node:deploy` (redeploy + wagmi codegen).

See [packages/contracts/README.md](packages/contracts/README.md) for deploy and artifact exports.

## Tests

```bash
yarn workspace @foresight/contracts test
yarn test:e2e
yarn format          # root files, then turbo per workspace
yarn format:check    # same, check only
```

## License

[MIT](./LICENSE) © Kleros
