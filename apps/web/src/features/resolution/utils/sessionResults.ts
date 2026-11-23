import { formatUnits } from "viem";

import { formatEstimate } from "@/utils/formatEstimate";

import type { OptionScale } from "@/types/optionScale";

import type { ChildResolution, ParentResolution, SessionResolution } from "../api/getSessionResolution";

/** What one whole token redeems for, in collateral base units. */
export interface TokenPayout {
  token: string;
  pays: bigint;
}

export type OptionResult =
  | { kind: "final"; value: number; text: string }
  | { kind: "waiting" }
  | { kind: "invalid"; payouts: TokenPayout[] }
  | { kind: "not-selected" }
  | { kind: "pending" }
  | { kind: "unread" };

export interface SessionResults {
  /** What the parent's INVALID token pays; null unless the parent resolved Invalid. */
  invalid: TokenPayout[] | null;
  /** By lowercase child market. */
  options: Record<string, OptionResult>;
}

type ResultOption = OptionScale & { outcomeIndex: number };

/** Seer's outcome tokens and sDAI both carry 18 decimals. */
const DECIMALS = 18;
const ONE_TOKEN = 10n ** BigInt(DECIMALS);
/** In the child's `payoutNumerators` order. */
const CHILD_TOKENS = ["DOWN", "UP", "INVALID"] as const;

const payout = (amount: bigint, numerator: bigint, denominator: bigint) => (amount * numerator) / denominator;

/**
 * A child token redeems for its parent outcome token, floored, which redeems for collateral at the parent's payout,
 * floored again.
 * @param child this option's child read; an Error where it failed, undefined while it is read.
 */
export function optionResult(
  parent: Extract<ParentResolution, { resolved: true }>,
  child: ChildResolution | Error | undefined,
  option: ResultOption,
): OptionResult {
  const outcomePays = (amount: bigint) =>
    payout(amount, parent.payoutNumerators[option.outcomeIndex] ?? 0n, parent.payoutDenominator);
  if (parent.invalid)
    return { kind: "invalid", payouts: [{ token: "this option's token", pays: outcomePays(ONE_TOKEN) }] };
  if (!parent.winningOutcomes.includes(option.outcomeIndex)) return { kind: "not-selected" };
  if (child === undefined) return { kind: "pending" };
  if (child instanceof Error || !child.deployed) return { kind: "unread" };
  if (!child.resolved) return { kind: "waiting" };
  if (child.invalid || child.finalValue === null) {
    const { payoutNumerators, payoutDenominator } = child;
    return {
      kind: "invalid",
      payouts: CHILD_TOKENS.map((token, slot) => ({
        token,
        pays: outcomePays(payout(ONE_TOKEN, payoutNumerators[slot] ?? 0n, payoutDenominator)),
      })),
    };
  }
  // the payouts cap at the bounds, so a side paid nothing means the answer was at or beyond the other bound
  const [down, up] = child.payoutNumerators;
  // the estimate grid's digits (a step two orders below the range), two at least
  const range = option.upperBound - option.lowerBound;
  const digits = range > 0 ? Math.min(20, Math.max(2, 2 - Math.floor(Math.log10(range)))) : 2;
  const text =
    down === 0n
      ? `${formatEstimate(option.upperBound, option.unit, boundDigits(option.upperBound, digits))} or more`
      : up === 0n
        ? `${formatEstimate(option.lowerBound, option.unit, boundDigits(option.lowerBound, digits))} or less`
        : formatEstimate(child.finalValue, option.unit, insideDigits(child.finalValue, option, digits));
  return { kind: "final", value: child.finalValue, text };
}

/** Fewest digits, from `digits` up to 20, that print a value inside the bounds as inside them. */
function insideDigits(value: number, { lowerBound, upperBound }: OptionScale, digits: number): number {
  if (!(lowerBound < value && value < upperBound)) return digits;
  let shown = digits;
  while (shown < 20) {
    const printed = Number(value.toFixed(shown));
    if (lowerBound < printed && printed < upperBound) break;
    shown += 1;
  }
  return shown;
}

/** Fewest digits, from `digits` up to 20, that print `bound` exactly. */
function boundDigits(bound: number, digits: number): number {
  let shown = digits;
  while (shown < 20 && Number(bound.toFixed(shown)) !== bound) shown += 1;
  return shown;
}

/** undefined until the parent is read as resolved. */
export function sessionResults(
  parent: ParentResolution | Error | undefined,
  children: SessionResolution["children"] | Error | undefined,
  options: readonly ResultOption[],
): SessionResults | undefined {
  if (parent === undefined || parent instanceof Error || !parent.resolved) return undefined;
  const invalidSlot = parent.payoutNumerators.length - 1;
  return {
    invalid: parent.invalid
      ? [
          {
            token: "the INVALID token",
            pays: payout(ONE_TOKEN, parent.payoutNumerators[invalidSlot] ?? 0n, parent.payoutDenominator),
          },
        ]
      : null,
    options: Object.fromEntries(
      options.map((option) => [
        option.market.toLowerCase(),
        optionResult(parent, children instanceof Error ? children : children?.[option.outcomeIndex], option),
      ]),
    ),
  };
}

/** Each payout to four decimals at most, cut rather than rounded, as the redeem floors. */
export function formatPayouts(payouts: TokenPayout[], symbol: string | null): string {
  return payouts
    .map(({ token, pays }) => {
      const [whole, fraction = ""] = formatUnits(pays, DECIMALS).split(".");
      const digits = fraction.slice(0, 4).replace(/0+$/, "");
      const amount = digits ? `${whole}.${digits}` : whole;
      return `${token} pays ${symbol ? `${amount} ${symbol}` : amount}`;
    })
    .join(", ");
}
