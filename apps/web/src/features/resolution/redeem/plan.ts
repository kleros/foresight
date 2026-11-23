import type { FlowTx } from "@foresight/tx-orchestrator";
import { encodeFunctionData, type Address } from "viem";

import { batchExecuteTx, executorAddress, type ExecutorCall } from "@/lib/trade-executor/executor";
import { approveCall } from "@/lib/trade-executor/positions";

import { gnosisRouterAbi, tradeExecutorFactoryAddress } from "@/config/contracts";

import { conditionalRouterAbi } from "./abi";
import type { SessionResolution } from "../api/getSessionResolution";
import { REDEEM_ALLOW_LIST } from "../oracle/allowlist";

/** A scalar child's slots are [DOWN, UP, INVALID]; oracle R4 orders its redeem indexes UP, DOWN, INVALID. */
export const CHILD_SLOTS = 3;
export const CHILD_REDEEM_ORDER = [1, 0, 2] as const;

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
  /**
   * Parent outcome indexes whose option won, whose child has not resolved, and in whose child the trade wallet
   * holds a token.
   */
  waiting: number[];
  payout: bigint;
  /** One `batchExecute` on the trade wallet; null when nothing is redeemable. */
  tx: FlowTx | null;
}

interface Redeemed {
  index: number;
  token: Address;
  amount: bigint;
  /** What the token pays, floored: sDAI at the parent, parent outcome tokens at a child. */
  pays: bigint;
}

const floorPay = (amount: bigint, numerator: bigint, denominator: bigint) => (amount * numerator) / denominator;

/** The full balance of each token, taken in `order`, that pays at least 1 wei (R1, R2). */
function paying(holdings: RedeemHolding[], numerators: bigint[], denominator: bigint, order: readonly number[]) {
  return order.flatMap((index): Redeemed[] => {
    const { token, balance } = holdings[index]!;
    const pays = balance === 0n ? 0n : floorPay(balance, numerators[index]!, denominator);
    return pays === 0n ? [] : [{ index, token, amount: balance, pays }];
  });
}

const sum = (values: bigint[]) => values.reduce((total, each) => total + each, 0n);

/** What the trade wallet can redeem now (oracle R1 to R5), and the one batch that redeems it into the trade wallet. */
export function planTradeWalletRedeem(input: TradeWalletRedeemInput): RedeemPlan {
  const { parent, children } = input.resolution;
  if (!parent.resolved) return { parts: [], waiting: [], payout: 0n, tx: null };
  const list = REDEEM_ALLOW_LIST[input.chainId];
  const factory = tradeExecutorFactoryAddress(input.chainId);
  if (!list || !factory) throw new Error(`Redeem is not available on chain ${input.chainId}.`);
  if (input.parentTokens.length !== parent.payoutNumerators.length) {
    throw new Error(
      `The parent has ${parent.payoutNumerators.length} outcomes but ${input.parentTokens.length} token balances.`,
    );
  }

  const parts: RedeemPart[] = [];
  const calls: ExecutorCall[] = [];
  const waiting: number[] = [];
  const redeemWith = (router: Address, redeemed: Redeemed[], data: `0x${string}`) =>
    calls.push(...redeemed.map(({ token, amount }) => approveCall(token, router, amount)), { to: router, data });

  const parentRedeemed = paying(
    input.parentTokens,
    parent.payoutNumerators,
    parent.payoutDenominator,
    parent.payoutNumerators.map((_, index) => index),
  );
  if (parentRedeemed.length > 0) {
    parts.push({ market: input.parentMarket, payout: sum(parentRedeemed.map(({ pays }) => pays)) });
    redeemWith(
      list.gnosisRouter,
      parentRedeemed,
      encodeFunctionData({
        abi: gnosisRouterAbi,
        functionName: "redeemPositions",
        args: [
          input.collateral,
          input.parentMarket,
          parentRedeemed.map(({ index }) => BigInt(index)),
          parentRedeemed.map(({ amount }) => amount),
        ],
      }),
    );
  }

  const options = parent.payoutNumerators.length - 1;
  for (let option = 0; option < options; option++) {
    const outcomeNumerator = parent.payoutNumerators[option]!;
    const child = children[option];
    if (outcomeNumerator === 0n || !child?.deployed) continue;
    const holdings = input.childTokens[option];
    if (holdings?.length !== CHILD_SLOTS) {
      throw new Error(`Option ${option}'s child needs ${CHILD_SLOTS} token balances.`);
    }
    if (!child.resolved) {
      if (holdings.some(({ balance }) => balance > 0n)) waiting.push(option);
      continue;
    }
    const redeemed = paying(holdings, child.payoutNumerators, child.payoutDenominator, CHILD_REDEEM_ORDER);
    // the child pays parent outcome tokens, which pay at the parent outcome's fraction: two floors (R5)
    const payout = floorPay(sum(redeemed.map(({ pays }) => pays)), outcomeNumerator, parent.payoutDenominator);
    if (payout === 0n) continue;
    parts.push({ market: child.market, payout });
    redeemWith(
      list.conditionalRouter,
      redeemed,
      encodeFunctionData({
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
    );
  }

  return {
    parts,
    waiting,
    payout: sum(parts.map(({ payout }) => payout)),
    tx: calls.length > 0 ? batchExecuteTx(executorAddress(factory, input.owner), calls) : null,
  };
}

export type WalletRedeemInput = TradeWalletRedeemInput;

export interface WalletRedeemPlan extends Omit<RedeemPlan, "tx"> {
  /** Sent from the connected account, in order; empty when nothing is redeemable. */
  calls: FlowTx[];
}

export function planWalletRedeem(_input: WalletRedeemInput): WalletRedeemPlan {
  throw new Error("not implemented");
}
