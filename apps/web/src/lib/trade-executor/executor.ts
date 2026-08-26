import type { FlowTx } from "@foresight/tx-orchestrator";
import { encodeFunctionData, zeroAddress, type Address } from "viem";

import { tradeExecutorFactoryAbi } from "@/config/contracts";

import type { ExecutorReadClient, ExecutorState } from "./types";

export async function fetchExecutorState(
  client: ExecutorReadClient,
  args: { factory: Address; owner: Address },
): Promise<ExecutorState> {
  const [predicted, deployed] = await Promise.all([
    client.readContract({
      address: args.factory,
      abi: tradeExecutorFactoryAbi,
      functionName: "predictExecutor",
      args: [args.owner],
    }),
    client.readContract({
      address: args.factory,
      abi: tradeExecutorFactoryAbi,
      functionName: "executorOf",
      args: [args.owner],
    }),
  ]);

  return { predicted, deployed: deployed === zeroAddress ? null : deployed };
}

export function createExecutorTx(factory: Address): FlowTx {
  return {
    to: factory,
    data: encodeFunctionData({ abi: tradeExecutorFactoryAbi, functionName: "createExecutor" }),
  };
}
