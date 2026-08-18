# @foresight/contracts

SessionFactory contracts, deploy scripts, and the generated viem/wagmi artifacts Foresight apps import.

## Local development

```bash
yarn start             # compile + hardhat node on :8545 (deploys SessionFactory + mocks)
yarn deploy:local      # redeploy to a running node + wagmi codegen
yarn test              # hardhat test suite
yarn simulate:session  # deploy a sample session through the running local factory
```

`simulate:session` drives the whole create flow against the local node (mock Seer markets
included), so the indexer has something to index. Flags:

| Flag                   | Default                               | Effect                                             |
| ---------------------- | ------------------------------------- | -------------------------------------------------- |
| `--outcomes <2-4>`     | `2`                                   | Parent outcome count                               |
| `--phased`             | atomic                                | `openPhasedSession` + one child batch tx per child |
| `--multi`              | categorical                           | Multi-categorical parent market                    |
| `--metadata-uri <uri>` | `@foresight/session-metadata` example | `metadataUri` emitted with the session             |

## Environment

Nothing is required for local work. Optional overrides, loaded by `hardhat.config.ts` from
`.env.local` then `.env` in this package (see [`.env.example`](.env.example)):

| Variable                      | Use                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| `SEER_MARKET_FACTORY_ADDRESS` | Override the Seer MarketFactory (default: `@seer-pm/contracts` deployment; mock on localhost) |
| `GNOSIS_RPC_URL`              | Gnosis RPC override; defaults to the public `rpc.gnosischain.com`                             |
| `DEPLOYER_PRIVATE_KEY`        | Signer for `gnosis` and `tenderly`                                                            |
| `BLOCKSCOUT_API_KEY`          | Blockscout multichain API key, for `verify:gnosis`                                            |
| `TENDERLY_RPC_URL`            | Tenderly fork RPC                                                                             |

## Deploying to Gnosis

Seer's MarketFactory on chain 100 resolves from `@seer-pm/contracts`.

```bash
yarn deploy:gnosis            # deploy + `codegen:gnosis`, writing deployments/gnosis.viem.ts
yarn verify:gnosis:sourcify   # no API key
yarn verify:gnosis            # Blockscout; needs BLOCKSCOUT_API_KEY
```

**`ETHERSCAN_API_KEY` in the environment overrides the configured key**, because
hardhat-deploy checks that variable before any config.

## Imports

| Import                               | Use when                                    |
| ------------------------------------ | ------------------------------------------- |
| `@foresight/contracts`               | wagmi / viem bindings + `getAddress` helper |
| `@foresight/contracts/deployments/*` | raw hardhat-deploy JSON                     |

Run `yarn codegen:localhost` or `yarn codegen:gnosis` after deploying to that network.

## Usage

```ts
import { getAddress, localhost } from "@foresight/contracts";
import { createPublicClient, getContract, http } from "viem";
import { hardhat } from "viem/chains";

const chain = hardhat;
const client = createPublicClient({ chain, transport: http("http://127.0.0.1:8545") });

const address = getAddress(localhost.sessionFactoryConfig, chain.id);
const sessionFactory = getContract({
  address,
  abi: localhost.sessionFactoryAbi,
  client,
});

const sessionCount = await sessionFactory.read.sessionCount();
```

`getAddress` throws if codegen has no deployment for that `chainId` (e.g. gnosis before `deploy:gnosis`).
