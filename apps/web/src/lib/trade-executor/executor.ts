import type { FlowTx } from "@foresight/tx-orchestrator";
import { encodeFunctionData, zeroAddress, type Address, type Hex } from "viem";

import { tradeExecutorFactoryAbi, tradeExecutorAbi } from "@/config/contracts";

import type { ExecutorReadClient, ExecutorState } from "./types";

export type ExecutorCall = { to: Address; data: Hex };

export type ExecutorValueCall = ExecutorCall & { value: bigint };

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

/** The executor runs `calls` in order, from its own balances, in one transaction. */
export function batchExecuteTx(executor: Address, calls: ExecutorCall[]): FlowTx {
  return {
    to: executor,
    data: encodeFunctionData({ abi: tradeExecutorAbi, functionName: "batchExecute", args: [calls] }),
  };
}

/** As `batchExecuteTx`, with each call carrying native value out of the executor. */
export function batchValueExecuteTx(executor: Address, calls: ExecutorValueCall[]): FlowTx {
  return {
    to: executor,
    data: encodeFunctionData({ abi: tradeExecutorAbi, functionName: "batchValueExecute", args: [calls] }),
  };
}
