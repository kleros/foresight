import type { FlowTx } from "@foresight/tx-orchestrator";
import { decodeFunctionData, encodeFunctionData, erc20Abi, isAddressEqual, parseAbi, slice, type Address } from "viem";

import { batchExecuteTx, type ExecutorCall } from "@/lib/trade-executor/executor";

import { conditionalRouterAbi } from "./abi";
import { planTradeWalletRedeem, type RedeemPlan, type TradeWalletRedeemInput } from "./plan";
import { redeemBatchDepartures, type RedeemScope } from "./tradeWalletBatchAllowed";
import type { SessionResolution } from "../api/getSessionResolution";
import { REDEEM_ALLOW_LIST, type RedeemAllowList } from "../oracle/allowlist";

/** What a ticked trade wallet batch is checked against, read on-chain: the trade wallet's `owner()` and the resolution. */
export interface OwnerPayout {
  owner: Address;
  resolution: SessionResolution;
}

/** One function each, so a call decodes only as the function its selector was allowed as. */
const BATCH_ABI = parseAbi(["function batchExecute((address to, bytes data)[] calls)"]);
const TRANSFER_ABI = parseAbi(["function transfer(address to, uint256 amount)"]);
const REDEEM_POSITIONS_ABI = parseAbi([
  "function redeemPositions(address collateralToken, address market, uint256[] outcomeIndexes, uint256[] amounts)",
]);

const same = (a: Address, b: Address) => isAddressEqual(a, b);
const floorPay = (amount: bigint, numerator: bigint, denominator: bigint) => (amount * numerator) / denominator;

/** The trade wallet redeem with the pay-to-owner box ticked (spec D12, oracle R3). */
export function planTradeWalletRedeemToOwner(input: TradeWalletRedeemInput, owner: Address): RedeemPlan {
  return withOwnerTransfer(planTradeWalletRedeem(input), input.collateral, owner);
}

/** `plan`'s batch, then one transfer of its payout in `collateral` to `owner`; a plan with no batch stays as it is. */
export function withOwnerTransfer(plan: RedeemPlan, collateral: Address, owner: Address): RedeemPlan {
  if (!plan.tx) return plan;
  const [calls] = decodeFunctionData({ abi: BATCH_ABI, data: plan.tx.data! }).args;
  const payOwner: ExecutorCall = {
    to: collateral,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [owner, plan.payout] }),
  };
  return { ...plan, tx: batchExecuteTx(plan.tx.to, [...calls, payOwner]) };
}

/** Every way a ticked trade wallet batch departs from oracle R2 to R5; empty when it keeps to them. */
export function ownerPayBatchDepartures(args: {
  tx: FlowTx;
  chainId: number;
  account: Address;
  scope: RedeemScope;
  payout: OwnerPayout;
}): string[] {
  const { tx, chainId, account, scope, payout } = args;
  const list = REDEEM_ALLOW_LIST[chainId];
  const batch = list?.calls.find((call) => call.target === "tradeWallet");
  const transfer = list?.calls.find((call) => call.target === "collateral");
  const data = tx.data ?? "0x";
  if (!list || !batch || !transfer || data.length < 10 || slice(data, 0, 4) !== batch.selector) {
    return redeemBatchDepartures({ tx, chainId, account, scope });
  }

  const [calls] = decodeFunctionData({ abi: BATCH_ABI, data }).args;
  const last = calls.at(-1);
  const endsWithTransfer =
    last !== undefined &&
    same(last.to, scope.collateral) &&
    last.data.length >= 10 &&
    slice(last.data, 0, 4) === transfer.selector;
  // the redeems are checked as an unticked batch, so any transfer among them is refused there
  const redeems = endsWithTransfer ? calls.slice(0, -1) : calls;
  const out = redeemBatchDepartures({
    tx: { ...tx, data: encodeFunctionData({ abi: BATCH_ABI, args: [redeems] }) },
    chainId,
    account,
    scope,
  });
  if (!endsWithTransfer) return [...out, `does not end with one ${transfer.name} of sDAI to the owner`];

  let decoded;
  try {
    decoded = decodeFunctionData({ abi: TRANSFER_ABI, data: last.data }).args;
  } catch {
    return [...out, `the last call does not decode as ${transfer.name}`];
  }
  const [recipient, amount] = decoded;
  if (!same(recipient, payout.owner)) out.push(`pays ${recipient}, not the trade wallet's owner ${payout.owner}`);
  if (out.length > 0) return out;
  const expected = redeemedPayout(redeems, payout.resolution, list);
  if (typeof expected === "string") return [expected];
  if (expected === 0n) return ["the redeems pay nothing to transfer"];
  if (amount !== expected) out.push(`transfers ${amount}, not the payout ${expected}`);
  return out;
}

/**
 * Oracle R5 over the batch's own redeem calls, from `resolution`'s numerators: parent tokens floored once, a child's
 * tokens floored into parent outcome tokens and again at that outcome's fraction. `calls` already keep to R2 to R4.
 */
function redeemedPayout(
  calls: readonly ExecutorCall[],
  { parent, children }: SessionResolution,
  list: RedeemAllowList,
): bigint | string {
  if (!parent.resolved) return "the parent has not resolved";
  const parentPays = (index: bigint) => parent.payoutNumerators[Number(index)] ?? 0n;
  let total = 0n;
  for (const { to, data } of calls) {
    if (same(to, list.gnosisRouter)) {
      const [, , indexes, amounts] = decodeFunctionData({ abi: REDEEM_POSITIONS_ABI, data }).args;
      indexes.forEach((index, slot) => {
        total += floorPay(amounts[slot]!, parentPays(index), parent.payoutDenominator);
      });
    } else if (same(to, list.conditionalRouter)) {
      const [, market, indexes, [option], amounts] = decodeFunctionData({ abi: conditionalRouterAbi, data }).args;
      const child = children[Number(option)];
      if (!child?.deployed || !child.resolved || !same(child.market, market)) {
        return `redeems ${market}, which has not resolved`;
      }
      const outcomeTokens = indexes.reduce(
        (sum, index, slot) =>
          sum + floorPay(amounts[slot]!, child.payoutNumerators[Number(index)] ?? 0n, child.payoutDenominator),
        0n,
      );
      total += floorPay(outcomeTokens, parentPays(option!), parent.payoutDenominator);
    }
  }
  return total;
}
