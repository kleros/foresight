import { utcInstant } from "@/utils/date";

import { isLegibleBranchColor } from "./branchColor";
import { branchBoundSources, branchBounds, branchBoundsWei, branchQuestion, branchToken } from "./branchFields";
import { OUTCOME_PLACEHOLDER } from "./composeMarketName";
import { scaleToWei } from "./scaleToWei";
import { MAX_BRANCH_TOKEN_BYTES, tokenByteLength } from "./slugToken";
import { carriesMultiplier, findUnit, isListedUnit } from "./units";
import type { DraftAssessment, DraftIssue, OutcomeDraft, SessionDraft } from "../types/draft";

const hasBrackets = (s: string) => /[[\]]/.test(s);

/** Reality and Seer substitute these into JSON unescaped: `"` and `\` end the string, U+241F the field. */
const REALITY_FIELD_SEPARATOR = "\u241f";
const breaksTheOracleQuestion = (s: string) => /["\\]/.test(s) || s.includes(REALITY_FIELD_SEPARATOR);
const ORACLE_ADVICE = "would break the question Reality.eth asks. Remove it.";

/** Above this, a session is flagged as long running. */
export const LONG_RUN_DAYS = 30;
const LONG_RUN_MS = LONG_RUN_DAYS * 24 * 60 * 60 * 1000;
/** Shared with the steps, which show the same warning beside the date that caused it. */
export const LONG_RUN_NOTE = `runs longer than ${LONG_RUN_DAYS} days`;

const runsLong = (instant: Date | null, now: Date) => !!instant && instant.getTime() - now.getTime() > LONG_RUN_MS;

function decisionInstant(draft: SessionDraft): Date | null {
  return utcInstant(draft.decisionDate, draft.decisionTime);
}

export function metricInstant(draft: SessionDraft, o: OutcomeDraft): Date | null {
  if (o.override && o.metricDate) {
    return utcInstant(o.metricDate, o.metricTime || draft.decisionTime);
  }
  return decisionInstant(draft);
}

function metricOk(draft: SessionDraft, o: OutcomeDraft): boolean {
  const decision = decisionInstant(draft);
  const metric = metricInstant(draft, o);
  return !!decision && !!metric && metric.getTime() >= decision.getTime();
}

function duplicateOutcomeLabels(outcomes: OutcomeDraft[]): string[] {
  const seen = new Set<string>();
  const dups: string[] = [];
  for (const o of outcomes) {
    const key = o.label.trim().toLowerCase();
    if (!key) continue;
    if (seen.has(key)) dups.push(o.label.trim());
    else seen.add(key);
  }
  return dups;
}

function duplicateTokens(outcomes: OutcomeDraft[]): string[] {
  const seen = new Set<string>();
  const dups: string[] = [];
  for (const o of outcomes) {
    const token = branchToken(o);
    if (!token) continue;
    // Case-blind: two tokens a wallet lists identically collide for everyone
    // but the chain.
    const key = token.toUpperCase();
    if (seen.has(key)) dups.push(key);
    else seen.add(key);
  }
  return dups;
}

function branchQuestionOk(draft: SessionDraft, o: OutcomeDraft): boolean {
  const question = branchQuestion(draft, o);
  return !!question.trim() && !hasBrackets(question) && !breaksTheOracleQuestion(question);
}

function branchBoundsOk(draft: SessionDraft, o: OutcomeDraft): boolean {
  const { lower, upper } = branchBoundsWei(draft, o);
  return lower !== null && upper !== null && lower < upper;
}

export function assessDraft(draft: SessionDraft, now: Date): DraftAssessment {
  const issues: DraftIssue[] = [];
  const warnings: DraftIssue[] = [];
  const add = (step: DraftIssue["step"], text: string) => issues.push({ step, text });
  const warn = (step: DraftIssue["step"], text: string) => warnings.push({ step, text });

  // Step 1: decision market
  if (!draft.name.trim()) add(1, "The decision has no question.");
  else if (hasBrackets(draft.name)) {
    add(1, "The decision contains square brackets, which are reserved for the unit.");
  } else if (breaksTheOracleQuestion(draft.name)) {
    add(1, `The decision contains a quote or a backslash, which ${ORACLE_ADVICE}`);
  }
  if (draft.outcomes.length < 2) add(1, "A decision needs at least two outcomes.");
  if (draft.outcomes.some((o) => !o.label.trim())) add(1, "An outcome is unnamed.");
  const unquotable = draft.outcomes.find((o) => breaksTheOracleQuestion(o.label));
  if (unquotable) {
    add(1, `"${unquotable.label.trim()}" contains a quote or a backslash, which ${ORACLE_ADVICE}`);
  }
  const dupLabels = duplicateOutcomeLabels(draft.outcomes);
  if (dupLabels.length > 0) add(1, `Two outcomes are both called "${dupLabels[0]}".`);
  const dupTokens = duplicateTokens(draft.outcomes);
  if (dupTokens.length > 0) add(1, `Two token names are both ${dupTokens[0]}.`);

  const nameless = draft.outcomes.find((o) => o.label.trim() && !branchToken(o));
  if (nameless) {
    add(1, `"${nameless.label.trim()}" gives no token name. Write one under advanced settings.`);
  }
  const overlong = draft.outcomes.find((o) => tokenByteLength(branchToken(o)) > MAX_BRANCH_TOKEN_BYTES);
  if (overlong) {
    add(1, `The token name ${branchToken(overlong)} is too long. Keep it to ${MAX_BRANCH_TOKEN_BYTES} characters.`);
  }
  const bond = scaleToWei(draft.minBond);
  if (bond === null || bond <= 0n) add(1, "The minimum bond must be above zero.");
  const decision = decisionInstant(draft);
  const decisionFuture = !!decision && decision.getTime() > now.getTime();
  if (!decisionFuture) add(1, "Trading would close in the past.");
  else if (runsLong(decision, now)) {
    warn(1, `Trading ${LONG_RUN_NOTE}. Traders' money is tied up until it closes.`);
  }

  // Step 2: branch markets
  if (!draft.template.trim()) add(2, "No question template.");
  else if (!draft.template.includes(OUTCOME_PLACEHOLDER)) {
    add(2, "The template has no {outcome} in it.");
  } else if (hasBrackets(draft.template)) {
    add(2, "The template contains square brackets. The unit is added for you.");
  }
  const unit = draft.unit.trim();
  if (!unit) add(2, "No unit. Reality.eth would be guessing at the scale.");
  else if (hasBrackets(unit) || /\s/.test(unit)) {
    add(2, "The unit is just the symbol: no brackets, no spaces.");
  } else if (breaksTheOracleQuestion(unit)) {
    add(2, `The unit contains a quote or a backslash, which ${ORACLE_ADVICE}`);
  } else if (carriesMultiplier(unit)) {
    warn(
      2,
      `${unit} carries a multiplier, so the bounds have to be written in the same multiple. ` +
        `An answer of 200 means 200 ${unit}, not 200.`,
    );
  } else if (!isListedUnit(unit)) {
    warn(2, `${unit} is not one of the listed units, so the bounds cannot be checked against what it means.`);
  }
  const branchWarn = draft.outcomes.map(() => false);
  draft.outcomes.forEach((o, i) => {
    const bounds = branchBounds(draft, o);
    const branch = o.label.trim() || `Branch ${i + 1}`;
    if (!branchQuestionOk(draft, o) && breaksTheOracleQuestion(branchQuestion(draft, o))) {
      add(2, `${branch}'s question contains a quote or a backslash, which ${ORACLE_ADVICE}`);
    }
    const wei = branchBoundsWei(draft, o);
    if (bounds.lower < 0) add(2, `${branch}: a negative lower bound is impossible.`);
    else if (wei.lower === null || wei.upper === null) {
      const which = wei.lower === null ? "lower" : "upper";
      const typed = branchBoundSources(draft, o)[which].trim();
      add(
        2,
        typed ? `${branch}: the ${which} bound is not a plain number.` : `${branch}: the ${which} bound is not set.`,
      );
    } else if (wei.lower >= wei.upper) {
      add(2, `${branch}: lower bound is not below the upper bound.`);
    } else {
      // An answer past a bound pays that whole side and nothing to the other,
      // so a range the unit does not reach is a market with one outcome.
      const expected = findUnit(unit)?.expected;
      if (expected && (bounds.lower < expected.lower || bounds.upper > expected.upper)) {
        branchWarn[i] = true;
        warn(
          2,
          `${branch}: ${bounds.lower.toLocaleString()} to ${bounds.upper.toLocaleString()} is outside the ` +
            `${expected.lower} to ${expected.upper} ${unit} usually spans. Check the scale.`,
        );
      }
    }
    if (!metricOk(draft, o)) add(2, `${branch} closes before the decision does.`);
    else if (o.override && o.metricDate && runsLong(metricInstant(draft, o), now)) {
      warn(2, `${branch} ${LONG_RUN_NOTE}.`);
    }
  });

  // Step 3: display metadata
  if (!draft.title.trim()) add(3, "The session has no title.");
  if (!draft.description.trim()) {
    add(3, "The session has no description, so the card has no subtitle.");
  }
  if (!draft.heroImageName) add(3, "No hero image. The card has no artwork.");
  if (!draft.iconName) add(3, "No icon. The card falls back to a generated one.");
  draft.outcomes.forEach((o, i) => {
    if (!isLegibleBranchColor(o.color)) {
      const branch = o.label.trim() || `Branch ${i + 1}`;
      add(3, `${branch} has a colour that is not legible in both themes.`);
    }
  });

  const branchOk = draft.outcomes.map(
    (o) => branchQuestionOk(draft, o) && branchBoundsOk(draft, o) && metricOk(draft, o),
  );

  return {
    issues,
    warnings,
    steps: {
      parent: !issues.some((i) => i.step === 1),
      children: !issues.some((i) => i.step === 2),
      display: !issues.some((i) => i.step === 3),
    },
    branchOk,
    branchWarn,
  };
}
