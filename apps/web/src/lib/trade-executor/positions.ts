import type { FlowTx } from "@foresight/tx-orchestrator";
import { encodeFunctionData, erc20Abi, type Address } from "viem";

import { gnosisRouterAbi } from "@/config/contracts";

import { batchExecuteTx, type ExecutorCall } from "./executor";

interface RouterArgs {
  executor: Address;
  router: Address;
  /** What the market mints from, and what merging it back pays out. */
  collateral: Address;
  parentMarket: Address;
  amount: bigint;
}

interface MergeArgs extends RouterArgs {
  /** One per outcome, in any order. */
  outcomeTokens: Address[];
  /** Burnt with the rest, and carried apart because no outcome owns it. */
  invalidToken: Address;
}

export const approveCall = (token: Address, spender: Address, amount: bigint): ExecutorCall => ({
  to: token,
  data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }),
});

/** Collateral in, one outcome token per outcome out */
export function splitTx({ executor, router, collateral, parentMarket, amount }: RouterArgs): FlowTx {
  return batchExecuteTx(executor, [
    approveCall(collateral, router, amount),
    {
      to: router,
      data: encodeFunctionData({
        abi: gnosisRouterAbi,
        functionName: "splitPosition",
        args: [collateral, parentMarket, amount],
      }),
    },
  ]);
}

/** The whole outcome set back to collateral; the router burns every token, so every token is approved. */
export function mergeTx({
  executor,
  router,
  collateral,
  parentMarket,
  outcomeTokens,
  invalidToken,
  amount,
}: MergeArgs): FlowTx {
  if (outcomeTokens.length === 0) {
    throw new Error("Nothing to merge.");
  }

  return batchExecuteTx(executor, [
    ...[...outcomeTokens, invalidToken].map((token) => approveCall(token, router, amount)),
    {
      to: router,
      data: encodeFunctionData({
        abi: gnosisRouterAbi,
        functionName: "mergePositions",
        args: [collateral, parentMarket, amount],
      }),
    },
  ]);
}
