# @foresight/contracts

Contract artifacts for Foresight apps and tooling.

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
