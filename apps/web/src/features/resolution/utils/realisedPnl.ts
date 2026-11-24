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

const sum = (values: readonly bigint[]) => values.reduce((total, value) => total + value, 0n);

/** Oracle R5. */
const floorPay = (amount: bigint, numerator: bigint, denominator: bigint) => (amount * numerator) / denominator;

/** `total` in `count` equal parts; the first `|total| mod count` parts take one more unit, so the parts add up. */
function equalParts(total: bigint, count: number): bigint[] {
  const magnitude = total < 0n ? -total : total;
  const [base, extra] = [magnitude / BigInt(count), magnitude % BigInt(count)];
  return Array.from({ length: count }, (_, index) => {
    const part = base + (BigInt(index) < extra ? 1n : 0n);
    return total < 0n ? -part : part;
  });
}

/**
 * Realised P&L in sDAI per option and for the session (spec D16): each option costs an equal part of every split and
 * is paid its redeems, what its held tokens pay now (oracle R5) and an equal part of the parent INVALID payout.
 */
export function realisedPnl(input: RealisedPnlInput): RealisedPnl {
  const options = input.holdings.parent.length - 1;
  const costs = equalParts(sum(input.splits.map(({ amount }) => amount)), options);
  const account = input.account.toLowerCase();
  const redeemed = (index: number) =>
    sum(
      input.redeems
        .filter((row) => row.account.toLowerCase() === account && row.parentOutcomeIndex === BigInt(index))
        .map(({ payout }) => payout),
    );

  const { parent, children } = input.resolution;
  const result: RealisedPnl = { options: {}, session: { cost: 0n, payout: 0n, pnl: 0n, waiting: [] } };
  if (!parent.resolved) {
    costs.forEach((cost, index) => (result.options[index] = { status: "waiting", cost }));
    result.session.waiting = costs.map((_, index) => index);
    return result;
  }

  const { payoutNumerators, payoutDenominator } = parent;
  const held = (index: number) => floorPay(input.holdings.parent[index]!, payoutNumerators[index]!, payoutDenominator);
  const invalidParts = equalParts(redeemed(options) + held(options), options);

  for (let index = 0; index < options; index++) {
    const cost = costs[index]!;
    const numerator = payoutNumerators[index]!;
    const child = children[index];
    const childHeld = input.holdings.children[index] ?? [];
    if (numerator > 0n && child?.deployed && !child.resolved && childHeld.some((balance) => balance > 0n)) {
      result.options[index] = { status: "waiting", cost };
      result.session.waiting.push(index);
      continue;
    }

    let payout = redeemed(index) + held(index) + invalidParts[index]!;
    if (numerator > 0n && child?.deployed && child.resolved) {
      const parentTokens = sum(
        childHeld.map((balance, slot) =>
          floorPay(balance, child.payoutNumerators[slot] ?? 0n, child.payoutDenominator),
        ),
      );
      payout += floorPay(parentTokens, numerator, payoutDenominator);
    }
    result.options[index] = { status: "settled", cost, payout, pnl: payout - cost };
    result.session.cost += cost;
    result.session.payout += payout;
  }
  result.session.pnl = result.session.payout - result.session.cost;
  return result;
}
