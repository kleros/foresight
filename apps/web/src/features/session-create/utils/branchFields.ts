import { composeMarketName, resolveChildQuestion } from "./composeMarketName";
import { scaleToWei } from "./scaleToWei";
import { slugToken } from "./slugToken";
import type { OutcomeDraft, SessionDraft } from "../types/draft";

/** Bounds in the scale the transaction carries, or null where the text will not scale. */
export type BoundsWei = { lower: bigint | null; upper: bigint | null };

/**
 * A branch takes the decision's question, bounds and closing time unless its
 * override flag is set. Every screen that shows a branch resolves it through
 * here, so the rule is written once.
 */

/** Its own field, or its label's slug where that is empty. Seer refuses an empty one. */
export function branchToken(outcome: OutcomeDraft): string {
  return outcome.token.trim() || slugToken(outcome.label);
}

/** The two scalar tokens a branch mints, named after its outcome's. */
export function branchTokenPair(outcome: OutcomeDraft): [string, string] {
  const token = branchToken(outcome);
  return [`${token}_DOWN`, `${token}_UP`];
}

/** Bounds are typed, so a half-typed one reads as zero rather than NaN. */
export function parseNumber(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Field by field: overriding the closing time alone keeps the shared range. */
export function branchBoundSources(draft: SessionDraft, outcome: OutcomeDraft): { lower: string; upper: string } {
  return {
    lower: outcome.override && outcome.lower ? outcome.lower : draft.lower,
    upper: outcome.override && outcome.upper ? outcome.upper : draft.upper,
  };
}

export function branchBounds(draft: SessionDraft, outcome: OutcomeDraft): { lower: number; upper: number } {
  const source = branchBoundSources(draft, outcome);
  return { lower: parseNumber(source.lower), upper: parseNumber(source.upper) };
}

/** Read by anything deciding rather than drawing: a float takes the front of text this refuses. */
export function branchBoundsWei(draft: SessionDraft, outcome: OutcomeDraft): BoundsWei {
  const source = branchBoundSources(draft, outcome);
  return { lower: scaleToWei(source.lower), upper: scaleToWei(source.upper) };
}

/** The question alone, without the unit. Trimmed, as the parent's outcomes are. */
export function branchQuestion(draft: SessionDraft, outcome: OutcomeDraft): string {
  return resolveChildQuestion({
    template: draft.template,
    outcomeLabel: outcome.label.trim(),
    override: outcome.override ? outcome.childQuestion : undefined,
  });
}

/** The question as Reality.eth will show it, unit included. */
export function branchMarketName(draft: SessionDraft, outcome: OutcomeDraft): string {
  return composeMarketName(branchQuestion(draft, outcome), draft.unit.trim());
}

export function branchDisplayName(outcome: OutcomeDraft, index: number): string {
  return outcome.displayName || outcome.label || `Outcome ${index + 1}`;
}
