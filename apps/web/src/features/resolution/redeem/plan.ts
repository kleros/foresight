import type { FlowTx } from "@foresight/tx-orchestrator";
import type { Address } from "viem";

import type { SessionResolution } from "../api/getSessionResolution";

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

export function planTradeWalletRedeem(_input: TradeWalletRedeemInput): RedeemPlan {
  throw new Error("not implemented");
}
