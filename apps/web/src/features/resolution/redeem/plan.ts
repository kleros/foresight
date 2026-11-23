import type { FlowTx } from "@foresight/tx-orchestrator";
import { encodeFunctionData, parseAbi, type Address } from "viem";

import { batchExecuteTx, executorAddress, type ExecutorCall } from "@/lib/trade-executor/executor";
import { approveCall } from "@/lib/trade-executor/positions";

import { gnosisRouterAbi, tradeExecutorFactoryAddress } from "@/config/contracts";

import type { SessionResolution } from "../api/getSessionResolution";
import { REDEEM_ALLOW_LIST } from "../oracle/allowlist";

export const conditionalRouterAbi = parseAbi([
  "function redeemConditionalToCollateral(address collateralToken, address market, uint256[] outcomeIndexes, uint256[] parentOutcomeIndexes, uint256[] amounts)",
]);

/** A child's outcome indexes in the order oracle R4 fixes: UP, DOWN, INVALID. */
const CHILD_ORDER = [1, 0, 2];

export interface RedeemHolding {
  token: Address;
  balance: bigint;
}

export interface TradeWalletRedeemInput {
  chainId: number;
  /** The connected account; the batch goes to its own trade wallet. */
  owner: Address;
  /** sDAI. */
  collateral: Address;
  parentMarket: Address;
  resolution: SessionResolution;
  /** The parent's `wrappedOutcome(i)`, options then INVALID, with the trade wallet's balance. */
  parentTokens: RedeemHolding[];
  /** Keyed by parent outcome index: the child's `wrappedOutcome(0..2)`, [DOWN, UP, INVALID]. */
  childTokens: Partial<Record<number, RedeemHolding[]>>;
}

export interface RedeemPart {
  market: Address;
  /** sDAI base units. */
  payout: bigint;
}

export interface RedeemPlan {
  parts: RedeemPart[];
  /** Parent outcome indexes whose option won and whose child has not resolved. */
  waiting: number[];
  payout: bigint;
  /** One `batchExecute` on the trade wallet; null when nothing is redeemable. */
  tx: FlowTx | null;
}

interface Redeemed {
  index: number;
  token: Address;
  amount: bigint;
  payout: bigint;
}

const pay = (amount: bigint, numerator: bigint, denominator: bigint) => (amount * numerator) / denominator;

/** The full balance of each token, in `order`, that pays at least 1 wei. */
function paying(holdings: RedeemHolding[], numerators: bigint[], denominator: bigint, order: number[]): Redeemed[] {
  return order.flatMap((index) => {
    const holding = holdings[index];
    const numerator = numerators[index] ?? 0n;
    if (!holding || holding.balance === 0n || numerator === 0n) return [];
    const payout = pay(holding.balance, numerator, denominator);
    return payout === 0n ? [] : [{ index, token: holding.token, amount: holding.balance, payout }];
  });
}

const approvals = (redeemed: Redeemed[], router: Address) =>
  redeemed.map(({ token, amount }) => approveCall(token, router, amount));

/** What the trade wallet can redeem now (oracle R1 to R5), and the one batch that redeems it into the trade wallet. */
export function planTradeWalletRedeem(input: TradeWalletRedeemInput): RedeemPlan {
  const { parent, children } = input.resolution;
  if (!parent.resolved) return { parts: [], waiting: [], payout: 0n, tx: null };
  const list = REDEEM_ALLOW_LIST[input.chainId];
  const factory = tradeExecutorFactoryAddress(input.chainId);
  if (!list || !factory) throw new Error(`Redeem is not available on chain ${input.chainId}.`);

  const parts: RedeemPart[] = [];
  const calls: ExecutorCall[] = [];
  const waiting: number[] = [];

  const parentRedeemed = paying(
    input.parentTokens,
    parent.payoutNumerators,
    parent.payoutDenominator,
    parent.payoutNumerators.map((_, index) => index),
  );
  if (parentRedeemed.length > 0) {
    parts.push({ market: input.parentMarket, payout: parentRedeemed.reduce((sum, each) => sum + each.payout, 0n) });
    calls.push(...approvals(parentRedeemed, list.gnosisRouter), {
      to: list.gnosisRouter,
      data: encodeFunctionData({
        abi: gnosisRouterAbi,
        functionName: "redeemPositions",
        args: [
          input.collateral,
          input.parentMarket,
          parentRedeemed.map(({ index }) => BigInt(index)),
          parentRedeemed.map(({ amount }) => amount),
        ],
      }),
    });
  }

  const options = parent.payoutNumerators.length - 1;
  for (let option = 0; option < options; option++) {
    const outcomeNumerator = parent.payoutNumerators[option]!;
    const child = children[option];
    if (outcomeNumerator === 0n || !child?.deployed) continue;
    if (!child.resolved) {
      waiting.push(option);
      continue;
    }
    const redeemed = paying(
      input.childTokens[option] ?? [],
      child.payoutNumerators,
      child.payoutDenominator,
      CHILD_ORDER,
    );
    // the child pays parent outcome tokens, which then pay at the parent outcome's fraction (R5)
    const outcomeTokens = redeemed.reduce((sum, each) => sum + each.payout, 0n);
    const payout = pay(outcomeTokens, outcomeNumerator, parent.payoutDenominator);
    if (payout === 0n) continue;
    parts.push({ market: child.market, payout });
    calls.push(...approvals(redeemed, list.conditionalRouter), {
      to: list.conditionalRouter,
      data: encodeFunctionData({
        abi: conditionalRouterAbi,
        functionName: "redeemConditionalToCollateral",
        args: [
          input.collateral,
          child.market,
          redeemed.map(({ index }) => BigInt(index)),
          [BigInt(option)],
          redeemed.map(({ amount }) => amount),
        ],
      }),
    });
  }

  return {
    parts,
    waiting,
    payout: parts.reduce((sum, part) => sum + part.payout, 0n),
    tx: calls.length > 0 ? batchExecuteTx(executorAddress(factory, input.owner), calls) : null,
  };
}
