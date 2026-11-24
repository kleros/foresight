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

/** A trade wallet's indexed transfer with Seer's router; `amount` is negative leaving the wallet. */
export interface RouterTransfer {
  transactionHash: string;
  token: string;
  amount: bigint;
}

/**
 * The sDAI each transaction moving the session's parent tokens through Seer's router split into them: what the
 * wallet sent the router less what came back, with that transaction's parent redeem payouts added back.
 */
export function splitDeposits(
  transfers: RouterTransfer[],
  redeems: RedeemRow[],
  { collateral, parentTokens }: { collateral: string; parentTokens: readonly string[] },
): SplitDeposit[] {
  const tokens = new Set(parentTokens.map((token) => token.toLowerCase()));
  const hashes = new Set(
    transfers.filter((each) => tokens.has(each.token.toLowerCase())).map((each) => each.transactionHash),
  );
  return [...hashes].map((transactionHash) => ({
    transactionHash,
    amount:
      redeems
        .filter((row) => row.transactionHash === transactionHash && row.childMarket_id === null)
        .reduce((sum, row) => sum + row.payout, 0n) -
      transfers
        .filter(
          (each) => each.transactionHash === transactionHash && each.token.toLowerCase() === collateral.toLowerCase(),
        )
        .reduce((sum, each) => sum + each.amount, 0n),
  }));
}

const floorPay = (amount: bigint, numerator: bigint, denominator: bigint) => (amount * numerator) / denominator;

/** Option `option`'s share of `total` split evenly over `count`; the shares add up to `total` exactly. */
const shareOf = (total: bigint, option: number, count: number) =>
  (total * BigInt(option + 1)) / BigInt(count) - (total * BigInt(option)) / BigInt(count);

/**
 * Realised P&L in sDAI per option and for the session, from the trade wallet's splits, holdings and redeems. An
 * option's payout is what its redeems paid plus what its held tokens pay now (oracle R5); the parent's INVALID
 * payout is shared evenly, as the cost is. Every option waits while the parent has not resolved.
 */
export function realisedPnl({ account, resolution, splits, holdings, redeems }: RealisedPnlInput): RealisedPnl {
  const count = holdings.parent.length - 1;
  const { parent, children } = resolution;
  const deposited = splits.reduce((sum, each) => sum + each.amount, 0n);
  const redeemed = (index: number) =>
    redeems
      .filter((row) => row.account.toLowerCase() === account.toLowerCase() && row.parentOutcomeIndex === BigInt(index))
      .reduce((sum, row) => sum + row.payout, 0n);
  const parentPays = (index: number) =>
    parent.resolved ? floorPay(holdings.parent[index]!, parent.payoutNumerators[index]!, parent.payoutDenominator) : 0n;
  const invalidPayout = redeemed(count) + parentPays(count);

  const options: Record<number, OptionRealisedPnl> = {};
  const session = { cost: 0n, payout: 0n, pnl: 0n, waiting: [] as number[] };
  for (let option = 0; option < count; option++) {
    const cost = shareOf(deposited, option, count);
    const numerator = parent.resolved ? parent.payoutNumerators[option]! : 0n;
    const child = children[option];
    if (!parent.resolved || (numerator > 0n && child?.deployed && !child.resolved)) {
      options[option] = { status: "waiting", cost };
      session.waiting.push(option);
      continue;
    }

    const held = holdings.children[option];
    const childPays =
      numerator > 0n && child?.deployed && child.resolved && held
        ? floorPay(
            held.reduce(
              (sum, balance, slot) => sum + floorPay(balance, child.payoutNumerators[slot]!, child.payoutDenominator),
              0n,
            ),
            numerator,
            parent.payoutDenominator,
          )
        : 0n;
    const payout = redeemed(option) + parentPays(option) + childPays + shareOf(invalidPayout, option, count);
    options[option] = { status: "settled", cost, payout, pnl: payout - cost };
    session.cost += cost;
    session.payout += payout;
    session.pnl += payout - cost;
  }
  return { options, session };
}
