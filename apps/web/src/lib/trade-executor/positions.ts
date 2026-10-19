import type { FlowTx } from "@foresight/tx-orchestrator";
import { encodeFunctionData, erc20Abi, type Address } from "viem";

import { gnosisRouterAbi } from "@/config/contracts";

import { batchExecuteTx, type ExecutorCall } from "./executor";
import { PreflightError } from "./preflightError";

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

/** The market a set is minted from or burnt back to: a session's parent, or one of its children. */
interface MarketCallArgs {
  router: Address;
  /**
   * The base collateral the condition is denominated in. The router takes this to identify the
   * position even for a child, where what actually moves is the parent outcome token below.
   */
  collateral: Address;
  /** What the executor hands over: the collateral at a parent, its outcome token at a child. */
  deposited?: Address;
  market: Address;
  amount: bigint;
}

interface MergeCallArgs extends MarketCallArgs {
  outcomeTokens: Address[];
  invalidToken: Address;
}

/** Collateral in, one outcome token per outcome out */
export function splitCalls({ router, collateral, deposited, market, amount }: MarketCallArgs): ExecutorCall[] {
  return [
    approveCall(deposited ?? collateral, router, amount),
    {
      to: router,
      data: encodeFunctionData({
        abi: gnosisRouterAbi,
        functionName: "splitPosition",
        args: [collateral, market, amount],
      }),
    },
  ];
}

/** The whole outcome set back to collateral; the router burns every token, so every token is approved. */
export function mergeCalls({
  router,
  collateral,
  market,
  outcomeTokens,
  invalidToken,
  amount,
}: MergeCallArgs): ExecutorCall[] {
  if (outcomeTokens.length === 0) {
    throw new PreflightError("Nothing to merge.");
  }

  return [
    ...[...outcomeTokens, invalidToken].map((token) => approveCall(token, router, amount)),
    {
      to: router,
      data: encodeFunctionData({
        abi: gnosisRouterAbi,
        functionName: "mergePositions",
        args: [collateral, market, amount],
      }),
    },
  ];
}

export function splitTx({ executor, parentMarket, ...rest }: RouterArgs): FlowTx {
  return batchExecuteTx(executor, splitCalls({ ...rest, market: parentMarket }));
}

export function mergeTx({ executor, parentMarket, ...rest }: MergeArgs): FlowTx {
  return batchExecuteTx(executor, mergeCalls({ ...rest, market: parentMarket }));
}
