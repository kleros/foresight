import { dune } from "@/testing/fixtures";

import type { DraftAssessment, OutcomeDraft, SessionDraft } from "../../types/draft";

/**
 * A complete draft, so a suite writes only the fields its assertions turn on.
 * The types carry twenty-odd fields between them and every suite was filling
 * them again, with defaults that had drifted apart.
 */

export function outcomeDraft(overrides: Partial<OutcomeDraft> = {}): OutcomeDraft {
  return {
    id: "o0",
    label: dune.directors[0],
    token: "",
    tokenTouched: false,
    displayName: "",
    color: "#7e1bd4",
    colorTouched: false,
    detailsMarkdown: "",
    images: [],
    override: false,
    childQuestion: "",
    lower: "",
    upper: "",
    metricDate: "",
    metricTime: "",
    ...overrides,
  };
}

/** Valid, and far enough out that a suite's own clock does not close it. */
export function sessionDraft(overrides: Partial<SessionDraft> = {}): SessionDraft {
  return {
    name: dune.question,
    outcomes: [
      outcomeDraft({ id: "a", label: dune.directors[0] }),
      outcomeDraft({ id: "b", label: dune.directors[1] }),
    ],
    multi: false,
    category: "market",
    language: "en_US",
    minBond: "0.1",
    decisionDate: "2099-09-20",
    decisionTime: "12:00",
    template: dune.template,
    unit: dune.unit,
    lower: "0",
    upper: "500",
    title: dune.title,
    description: dune.description,
    itemName: dune.itemName,
    itemNamePlural: dune.itemNamePlural,
    heroImageName: "hero.jpg",
    iconName: "icon.png",
    ...overrides,
  };
}

/** An assessment with nothing to resolve, for the screens that read one. */
export function draftAssessment(overrides: Partial<DraftAssessment> = {}): DraftAssessment {
  return {
    issues: [],
    warnings: [],
    steps: { parent: true, children: true, display: true },
    branchOk: [],
    branchWarn: [],
    ...overrides,
  };
}
