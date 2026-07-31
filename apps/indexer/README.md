## Foresight indexer

Indexer for Foresight - permissionless futarchy

> This is a yarn workspace: run everything through yarn, not the `pnpm` in Envio's own
> docs, and never add a lockfile here.

### Run

```bash
yarn dev        # indexer + Hasura; playground on http://localhost:8080, password `testing`
yarn stop
```

Needs a chain to index. For local work start the contracts node first
(`yarn local-node:contracts` from the repo root), since the local chain's `rpc` points at
`http://localhost:8545`.

### Environment

Copy `.env.example` to `.env`.

**Every variable must be prefixed `ENVIO_`**

Read by our own code:

| Variable             | Required | Notes                                                                                                                               |
| -------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `ENVIO_RPC_URL`      | yes      | Local chain's `rpc` **and** the contract reads in [`src/utils/client.ts`](src/utils/client.ts). Defaults to `http://localhost:8545` |
| `ENVIO_IPFS_GATEWAY` | yes      | Our gateway for metadata, tried first; cloudflare then ipfs.io are the fallback                                                     |

Envio's own, the ones worth knowing:

| Variable             | Required | Notes                                                                                               |
| -------------------- | -------- | --------------------------------------------------------------------------------------------------- |
| `ENVIO_API_TOKEN`    | yes      | Create one at [envio.dev/app/api-tokens](https://envio.dev/app/api-tokens)                          |
| `ENVIO_TUI`          | no       | `false` forces the terminal UI off. Unset already auto-disables under CI, agents and non-TTY output |
| `ENVIO_PG_*`         | no       | Postgres connection. Only set when pointing at a database envio did not provision itself            |
| `ENVIO_INDEXER_PORT` | no       | Defaults suit local work                                                                            |

When adding a per-chain RPC, follow the naming : `ENVIO_[network]_RPC_URL` and wire it into
`src/utils/client.ts`.

> **Turbo runs in strict env mode**, so a task only sees variables declared in its
> `turbo.json`. Only `codegen` declares them, as `passThroughEnv: ["ENVIO_*"]` - it hands
> `config.yaml` to the envio CLI, which substitutes `${ENVIO_RPC_URL}` itself.
> `passThroughEnv` and not `env`, because `env` means "this changes my output" and would
> make the cache key vary with an RPC url that changes nothing it generates.
>
> `test` deliberately declares nothing, which is what keeps a local `ENVIO_IPFS_GATEWAY`
> out of `yarn test`. None of this affects `envio` commands run directly, which read
> `.env` themselves.

### `config.yaml` is generated, edit the template

[`config.template.yaml`](config.template.yaml) is the source of truth. `yarn update`
regenerates `config.yaml` from it, replacing each `_PLACEHOLDER_` from that network's
deployment artifacts:

```bash
yarn update:local   # just the local chain; yarn local-stack does this for you
yarn update         # every chain in the template that has an artifact, it is recommended to run targeted update
yarn update gnosis  # Targeted update for that chain
```

### After changing the template or `schema.graphql`

```bash
yarn update       # only if the template changed
yarn codegen
yarn check-types
yarn lint
yarn test
```

### Layout

```
abis/**.ts            the read-from ABI, for on-chain calls
src/handlers/                  event handlers, auto-discovered by envio
src/utils/index.ts             shared helpers (ipfsPath)
src/utils/client.ts            viem clients, one per chain
src/utils/contracts/           contract reads, one effect per file
src/utils/ipfs/                gateway walk, and the metadata effect
tests/handlers/                handler tests
tests/utils/                   unit tests
```

### Pre-requisites

- Node 22 (pinned for the repo in the root `package.json` / `.nvmrc`)
- [Docker](https://www.docker.com/products/docker-desktop/) or [Podman](https://podman.io/)
