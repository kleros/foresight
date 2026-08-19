# Foresight

Permissionless futarchy on Gnosis.

## Layout

| Path                        | Package                       | Purpose                                                                            |
| --------------------------- | ----------------------------- | ---------------------------------------------------------------------------------- |
| `apps/web`                  | `web`                         | Participant UI. [apps/web/README.md](apps/web/README.md)                           |
| `apps/devtools`             | `@foresight/devtools`         | Local dev tools                                                                    |
| `apps/indexer`              | `foresight-indexer`           | Envio indexer. [apps/indexer/README.md](apps/indexer/README.md)                    |
| `packages/contracts`        | `@foresight/contracts`        | SessionFactory. [packages/contracts/README.md](packages/contracts/README.md)       |
| `packages/session-metadata` | `@foresight/session-metadata` | Session display-metadata schema. [its README](packages/session-metadata/README.md) |
| `packages/mock-atlas`       | `@foresight/mock-atlas`       | Local Atlas + IPFS gateway (dev/test). [its README](packages/mock-atlas/README.md) |

## Quick start

Requires Node 22+ and Yarn 4 (`corepack enable`). The indexer needs [Docker](https://www.docker.com/products/docker-desktop/).

```bash
yarn install
cp apps/web/.env.example apps/web/.env.local   # then fill it in
yarn dev                 # web at http://localhost:3000
```

The web app validates its environment at startup and refuses to boot without it - see
[apps/web/README.md](apps/web/README.md) for what each variable is.

The indexer has its own env file: `cp apps/indexer/.env.example apps/indexer/.env`, see
[apps/indexer/README.md](apps/indexer/README.md) for what each variable does.

The whole local stack in one tmux session: hardhat node, mock-atlas, indexer and web.

```bash
yarn local-stack         # start (wipes local deployments + indexed data)
yarn stop-local-stack    # stop stack
```

Or the same pieces by hand, in separate terminals:

```bash
yarn local-node:contracts    # terminal 1: compile + hardhat node
yarn mock-atlas              # terminal 2: mock Atlas + IPFS gateway on :4747
yarn indexer:dev             # terminal 3: envio indexer + hasura on :8080
```

When running by hand, point the indexer at the mock gateway (`ENVIO_IPFS_GATEWAY`) and web at
the mock Atlas (`NEXT_PUBLIC_ATLAS_URI`). Both are in the `.env.example`s. `yarn local-stack`
wires all of this for you.

After **contract changes** while the node is still running: `yarn local-node:deploy` (redeploy + wagmi codegen).

To populate the stack with data, `yarn simulate:session` deploys a sample session (mock Seer
markets + example metadata) that the indexer picks up. Flags in
[packages/contracts/README.md](packages/contracts/README.md).

See [packages/contracts/README.md](packages/contracts/README.md) for deploy and artifact exports.

## Environments

The chain is never inferred, it comes from a file or a flag.

|                | local                                         | gnosis                                              |
| -------------- | --------------------------------------------- | --------------------------------------------------- |
| chain          | hardhat, `31337`, `yarn local-node:contracts` | Gnosis, `100`, live                                 |
| Seer factory   | `MockSeerMarketFactory`, deployed locally     | real one, from `@seer-pm/contracts`                 |
| Atlas + IPFS   | `yarn mock-atlas` on `:4747`                  | staging/production Atlas                            |
| contracts      | `yarn local-node:deploy`                      | `yarn workspace @foresight/contracts deploy:gnosis` |
| indexer config | `config.localhost.yaml`                       | `config.gnosis.yaml`                                |
| indexer        | `yarn indexer:dev`                            | `yarn indexer:dev:gnosis`                           |
| web            | `yarn dev`                                    | `yarn dev:gnosis`                                   |

`yarn local-stack` is local-only: Gnosis needs no node and no mock Atlas, just the indexer
and web. Each tool keeps its own base env file, plus one override per non-local network:

| Package              | base         | gnosis override |
| -------------------- | ------------ | --------------- |
| `apps/web`           | `.env.local` | `.env.gnosis`   |
| `apps/indexer`       | `.env`       | `.env.gnosis`   |
| `packages/contracts` | `.env`       | -               |

Every `.env*` is gitignored except `*.example`. The deployed indexer takes its variables from
the Envio Cloud dashboard, and the deployed web app from its host.

## Tests

```bash
yarn workspace @foresight/contracts test
yarn workspace foresight-indexer test
yarn test:e2e
yarn format          # root files, then turbo per workspace
yarn format:check    # same, check only
```

## License

[MIT](./LICENSE) © Kleros
