import type { SessionResolution } from "../api/getSessionResolution";

/** One indexed redeem, as the indexer's `Redeem` rows hold it. */
export interface RedeemRow {
  /** The wallet that held the redeemed tokens, lowercase. */
  account: string;
  /** The child market redeemed; null for parent outcome tokens. */
  childMarket_id: string | null;
  /** The parent's INVALID is the option count. */
  parentOutcomeIndex: bigint;
  /** sDAI base units. */
  payout: bigint;
  transactionHash: string;
}

/** sDAI one prediction split into parent outcome tokens; negative where a merge returned sDAI. */
export interface SplitDeposit {
  transactionHash: string;
  amount: bigint;
}

export interface RealisedPnlInput {
  /** The trade wallet whose P&L is read, lowercase. */
  account: string;
  resolution: SessionResolution;
  splits: SplitDeposit[];
  /** The account's balances now: the parent's tokens, options then INVALID; each option's child [DOWN, UP, INVALID]. */
  holdings: { parent: bigint[]; children: Partial<Record<number, readonly bigint[]>> };
  redeems: RedeemRow[];
}

/** sDAI base units. */
export type OptionRealisedPnl =
  | { status: "settled"; cost: bigint; payout: bigint; pnl: bigint }
  /** The option won and its own market has not resolved. */
  | { status: "waiting"; cost: bigint };

export interface RealisedPnl {
  /** Keyed by parent outcome index. */
  options: Record<number, OptionRealisedPnl>;
  /** The settled options summed; `waiting` lists the parent outcome indexes left out. */
  session: { cost: bigint; payout: bigint; pnl: bigint; waiting: number[] };
}

/** Realised P&L in sDAI per option and for the session, from the trade wallet's splits, holdings and redeems. */
export function realisedPnl(input: RealisedPnlInput): RealisedPnl {
  void input;
  throw new Error("not implemented");
}
