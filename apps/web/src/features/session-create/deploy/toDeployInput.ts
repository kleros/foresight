import { utcInstant } from "@/utils/date";

import type { SessionDeployInput, SessionMetadataInput } from "../flow/types";
import type { OutcomeDraft, SessionDraft } from "../types/draft";
import { metricInstant } from "../utils/assessDraft";
import { branchBoundSources, branchMarketName, branchToken, branchTokenPair } from "../utils/branchFields";
import { scaleToWei } from "../utils/scaleToWei";

/**
 * Draft to deploy input.
 *
 * `assessDraft` already blocks the deploy button on every rule this repeats,
 * so reaching a throw here means the button was wrong. It throws anyway rather
 * than coercing.
 */

function required(value: bigint | null, what: string): bigint {
  if (value === null) throw new Error(`${what} is missing or not a number.`);
  return value;
}

/** Seconds since the epoch, which is what Reality's `openingTime` counts in. */
function toOpeningTime(instant: Date | null, what: string): number {
  if (!instant) throw new Error(`${what} is not set.`);
  return Math.floor(instant.getTime() / 1000);
}

export function toDeployInput(draft: SessionDraft): SessionDeployInput {
  const minBond = required(scaleToWei(draft.minBond), "The minimum bond");
  const decisionAt = toOpeningTime(utcInstant(draft.decisionDate, draft.decisionTime), "The decision date");

  return {
    multiCategoricalParent: draft.multi,
    parent: {
      marketName: draft.name.trim(),
      outcomes: draft.outcomes.map((o) => o.label.trim()),
      tokenNames: draft.outcomes.map(branchToken),
      category: draft.category,
      lang: draft.language,
      minBond,
      openingTime: decisionAt,
    },
    children: draft.outcomes.map((outcome, index) => {
      const bounds = branchBoundSources(draft, outcome);
      const lower = scaleToWei(bounds.lower);
      const upper = scaleToWei(bounds.upper);

      return {
        parentOutcomeIndex: index,
        // The same call the branch list renders, so there is one composition.
        marketName: branchMarketName(draft, outcome),
        tokenNames: branchTokenPair(outcome),
        lowerBound: required(lower, `The lower bound for ${outcome.label || `branch ${index + 1}`}`),
        upperBound: required(upper, `The upper bound for ${outcome.label || `branch ${index + 1}`}`),
        minBond,
        // Defaults to the decision itself, which is the earliest a branch may
        // resolve. The factory does not check this, so the mapping must.
        openingTime: toOpeningTime(metricInstant(draft, outcome), `The metric date for branch ${index + 1}`),
        category: draft.category,
        lang: draft.language,
      };
    }),
  };
}

export function toMetadataInput(draft: SessionDraft): Omit<SessionMetadataInput, "heroImage" | "icon"> {
  return {
    title: draft.title.trim(),
    description: draft.description.trim(),
    itemName: draft.itemName,
    itemNamePlural: draft.itemNamePlural,
    children: draft.outcomes.map((outcome: OutcomeDraft, index) => ({
      outcomeIndex: index,
      displayName: outcome.displayName.trim() || outcome.label.trim(),
      color: outcome.color,
      sections: [outcome.detailsMarkdown],
    })),
  };
}
