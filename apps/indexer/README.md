## Foresight indexer

Indexer for Foresight: permissionless futarchy

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
The gnosis-only values live in `.env.gnosis` instead, see [Running against Gnosis](#running-against-gnosis).

**Every variable must be prefixed `ENVIO_`**

Read by our own code:

| Variable                        | Required | Notes                                                                                                                               |
| ------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `ENVIO_LOCALHOST_RPC_URL`       | yes      | Local chain's `rpc` **and** the contract reads in [`src/utils/client.ts`](src/utils/client.ts). Defaults to `http://localhost:8545` |
| `ENVIO_GNOSIS_RPC_URL`          | yes      | **`.env.gnosis`** - preferred endpoint for chain 100 contract reads. Events come from HyperSync, not from here                      |
| `ENVIO_GNOSIS_FALLBACK_RPC_URL` | no       | **`.env.gnosis`** - tried after the above. Either may be empty; public endpoints are the last resort                                |
| `ENVIO_IPFS_GATEWAY`            | yes      | Our gateway for metadata, tried first; cloudflare then ipfs.io are the fallback                                                     |

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
> the generated config to the envio CLI, which substitutes `${ENVIO_LOCALHOST_RPC_URL}` itself.
> `passThroughEnv` and not `env`, because `env` means "this changes my output" and would
> make the cache key vary with an RPC url that changes nothing it generates.
>
> `test` deliberately declares nothing, which is what keeps a local `ENVIO_IPFS_GATEWAY`
> out of `yarn test`. None of this affects `envio` commands run directly, which read
> `.env` themselves.

### The configs are generated, edit the template

[`config.template.yaml`](config.template.yaml) is the source of truth. `yarn update` writes
one `config.<network>.yaml` per network named, replacing each `_PLACEHOLDER_` from that
network's deployment artifacts. Both generated files are committed:

```bash
yarn update:local   # config.localhost.yaml; yarn local-stack does this for you
yarn update:gnosis  # config.gnosis.yaml
yarn update localhost gnosis
```

A network is required, and each config carries only its own chain - envio syncs every chain
the file declares, and entity ids are not chain-namespaced, so one config, one chain.

### Running against Gnosis

```bash
cp .env.gnosis.example .env.gnosis   # gitignored
yarn dev:gnosis                      # envio dev --config config.gnosis.yaml
```

> **This leaves `.envio/types.d.ts` generated for chain 100**, and `envio dev` reruns codegen
> on every start. The generated types name the configured chain as a literal, so
> `yarn check-types` then fails on the handler tests, which are written against 31337. Run
> `yarn codegen:local` to put the local types back. Running `yarn codegen:gnosis` on its own
> does the same thing for the same reason.

Envio Cloud does not read `.env.gnosis` - set those variables in its dashboard, and point
the indexer at `apps/indexer/config.gnosis.yaml` as its config file path.

### After changing the template or `schema.graphql`

```bash
yarn update:local   # or update:gnosis; only if the template changed
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
