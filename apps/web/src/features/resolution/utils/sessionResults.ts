import { formatEstimate } from "@/utils/formatEstimate";

import type { OptionScale } from "@/types/optionScale";

import type { ChildResolution, ParentResolution, SessionResolution } from "../api/getSessionResolution";

type Scale = Pick<OptionScale, "lowerBound" | "upperBound" | "unit">;

/** A session option: its child market's scale, and its place among the parent's outcomes. */
export type ResultOption = OptionScale & { outcomeIndex: number };

/** What a resolved session shows for one option. */
export type OptionResult =
  /** `share` is the value's place on the option's scale, 0 to 1. */
  | { kind: "final"; value: number; text: string; share: number }
  /** The parent picked it; its own market has not resolved. */
  | { kind: "waiting" }
  | { kind: "not-selected" }
  | { kind: "invalid"; payouts: string }
  /** Its market's read failed. */
  | { kind: "unread" }
  /** Its market's read has not answered yet. */
  | { kind: "loading" };

export interface SessionResults<T extends ResultOption = ResultOption> {
  /** What each parent token pays where the parent resolved INVALID; null otherwise. */
  invalidPayouts: string | null;
  /** The parent's winning options, in the session's order; none where it resolved INVALID. */
  winners: T[];
  /** Keyed by lowercased child market. */
  options: Record<string, OptionResult>;
}

const MAX_DIGITS = 18;

/** `value` as `formatEstimate` shows it with `digits` places, read back as a number. */
const shownAt = (value: number, digits: number) =>
  Number(value.toLocaleString("en-US", { maximumFractionDigits: digits, useGrouping: false }));

/** The fewest places, two or more, that show `value` without rounding it. */
function exactDigits(value: number): number {
  for (let digits = 2; digits < MAX_DIGITS; digits++) if (shownAt(value, digits) === value) return digits;
  return MAX_DIGITS;
}

/** Three significant places, and more where fewer would round the value onto or past a bound. */
function insideDigits(value: number, { lowerBound, upperBound }: Scale): number {
  const significant = value === 0 ? 2 : Math.max(2, Math.ceil(-Math.log10(Math.abs(value))) + 2);
  for (let digits = Math.min(significant, MAX_DIGITS); digits < MAX_DIGITS; digits++) {
    const shown = shownAt(value, digits);
    if (shown > lowerBound && shown < upperBound) return digits;
  }
  return MAX_DIGITS;
}

/** A bound in the scale's unit, with every place it was set with. */
export const formatBound = (bound: number, unit: string | null) => formatEstimate(bound, unit, exactDigits(bound));

/**
 * A child's answer: a payout all to UP or all to DOWN cannot tell the bound from anything past it, so it reads
 * open-ended.
 */
export function finalValueText(value: number, [down, up]: readonly bigint[], scale: Scale): string {
  if (down === 0n) return `${formatBound(scale.upperBound, scale.unit)} or more`;
  if (up === 0n) return `${formatBound(scale.lowerBound, scale.unit)} or less`;
  return formatEstimate(value, scale.unit, insideDigits(value, scale));
}

type PayoutsOf = { payoutNumerators: readonly bigint[]; payoutDenominator: bigint };

/** A payout fraction to four places. */
const fraction = (numerator: bigint, denominator: bigint) =>
  formatEstimate(Number((numerator * 10_000n) / denominator) / 10_000, null, 4);

/** A scalar child's slots are [DOWN, UP, INVALID]. */
function childPayouts({ payoutNumerators: [down = 0n, up = 0n, invalid = 0n], payoutDenominator }: PayoutsOf) {
  const pays = (numerator: bigint) => fraction(numerator, payoutDenominator);
  return `Pays per token: UP ${pays(up)}, DOWN ${pays(down)}, INVALID ${pays(invalid)}`;
}

/** The parent's slots are its options, then INVALID; options that pay alike are named once. */
function parentPayouts({ payoutNumerators, payoutDenominator }: PayoutsOf, options: ResultOption[]) {
  const pays = (numerator: bigint) => fraction(numerator, payoutDenominator);
  const optionSlots = payoutNumerators.slice(0, -1);
  const invalid = payoutNumerators.at(-1) ?? 0n;
  const alike = optionSlots.every((numerator) => numerator === optionSlots[0]);
  const optionPart = alike
    ? `each option ${pays(optionSlots[0] ?? 0n)}`
    : options.map((option) => `${option.name} ${pays(optionSlots[option.outcomeIndex] ?? 0n)}`).join(", ");
  return `Pays per token: ${optionPart}, INVALID ${pays(invalid)}`;
}

function childResult(child: ChildResolution | undefined, option: ResultOption): OptionResult {
  if (child === undefined || !child.deployed || child.market.toLowerCase() !== option.market.toLowerCase()) {
    return { kind: "unread" };
  }
  if (!child.resolved) return { kind: "waiting" };
  if (child.invalid || child.finalValue === null) return { kind: "invalid", payouts: childPayouts(child) };
  const range = option.upperBound - option.lowerBound;
  const share = range > 0 ? Math.min(1, Math.max(0, (child.finalValue - option.lowerBound) / range)) : 0;
  return {
    kind: "final",
    value: child.finalValue,
    text: finalValueText(child.finalValue, child.payoutNumerators, option),
    share,
  };
}

/**
 * Each option's result once the parent resolved; undefined while it has not, or its read failed.
 * @param children each child's read by parent outcome index, or the Error it failed with; undefined while unread.
 */
export function sessionResults<T extends ResultOption>(
  parent: ParentResolution | Error | undefined,
  children: SessionResolution["children"] | Error | undefined,
  options: T[],
): SessionResults<T> | undefined {
  if (parent === undefined || parent instanceof Error || !parent.resolved) return undefined;
  const key = (option: T) => option.market.toLowerCase();

  if (parent.invalid) {
    return {
      invalidPayouts: parentPayouts(parent, options),
      winners: [],
      options: Object.fromEntries(options.map((option) => [key(option), { kind: "not-selected" } as const])),
    };
  }

  const winners = options.filter((option) => parent.winningOutcomes.includes(option.outcomeIndex));
  const resultOf = (option: T): OptionResult =>
    !winners.includes(option)
      ? { kind: "not-selected" }
      : children === undefined
        ? { kind: "loading" }
        : children instanceof Error
          ? { kind: "unread" }
          : childResult(children[option.outcomeIndex], option);

  return {
    invalidPayouts: null,
    winners,
    options: Object.fromEntries(options.map((option) => [key(option), resultOf(option)])),
  };
}
