import type { TestInfo } from "@playwright/test";

import type { DraftSpec } from "./create-wizard";

/**
 * The draft the deploy tests type in. The chain is not reset between them and
 * the metadata is content addressed, so each test gets a document of its own or
 * the "already deployed?" lookup answers with another test's session. The id
 * rather than the title: the description is on screen, and tests match on text.
 */

export const HERO = { name: "hero.png", mimeType: "image/png", buffer: Buffer.from("hero-image-bytes") };
export const ICON = { name: "icon.png", mimeType: "image/png", buffer: Buffer.from("creator-mark-bytes") };

const DUNE: DraftSpec = {
  decision: "Which director for Dune: Part Three?",
  outcomes: [
    { label: "Villeneuve", color: "#2f6fed", details: "Directed the first two." },
    { label: "Gerwig", color: "#c2185b", details: "Coming off Narnia." },
  ],
  decisionDate: "09202099",
  template: "Opening weekend gross if {outcome} directs",
  unit: "$M",
  lower: "0.5",
  upper: "500.25",
  title: "Dune: Part Three director",
  description: "Opening weekend gross per director.",
  itemName: "Director",
  itemNamePlural: "Directors",
  category: "business",
  language: "en_GB",
  minBond: "0.25",
  multi: false,
  hero: HERO,
  icon: ICON,
};

export function duneDraft(test: TestInfo, over: Partial<DraftSpec> = {}): DraftSpec {
  return { ...DUNE, description: `${DUNE.description} (${test.testId})`, ...over };
}

/**
 * The question the wizard composes for a branch, restated rather than imported:
 * asking the code what it should have produced catches nothing.
 */
export function childMarketName(draft: DraftSpec, outcomeLabel: string): string {
  return `${draft.template.replaceAll("{outcome}", outcomeLabel)} [${draft.unit}]`;
}

/** Every branch's question, in the order the outcomes are listed. */
export function childMarketNames(draft: DraftSpec): string[] {
  return draft.outcomes.map((outcome) => childMarketName(draft, outcome.label));
}

/**
 * Trading closes at noon UTC on the day picked, which is what the screen says.
 *
 * @param date `MMDDYYYY`, as typed into the date field.
 */
export function noonUtc(date: string): number {
  const month = Number(date.slice(0, 2));
  const day = Number(date.slice(2, 4));
  const year = Number(date.slice(4));
  return Math.floor(Date.UTC(year, month - 1, day, 12, 0, 0) / 1000);
}
