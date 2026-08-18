import { describe, expect, it } from "vitest";

import { outcomeDraft, sessionDraft } from "../../__tests__/support/drafts";
import type { OutcomeDraft, SessionDraft } from "../../types/draft";
import { toDeployInput } from "../toDeployInput";

/**
 * Every value one awkward draft puts on chain, written out. Literal rather than
 * resolved through the helpers the encoder uses, which would only assert it
 * agrees with itself.
 *
 * The draft spells out every field asserted below, defaults included, so the
 * expected values can be read against their inputs here and a shared fixture
 * cannot move them.
 */

const NOON_20_SEPT_2099 = Math.floor(Date.UTC(2099, 8, 20, 12, 0, 0) / 1000);
const HALF_PAST_NINE_1_OCT_2099 = Math.floor(Date.UTC(2099, 9, 1, 9, 30, 0) / 1000);

/** What the draft's amounts below become, each scaled by 1e18. Written out, not scaled here. */
const WEI = {
  "1e-7": 100_000_000_000n,
  "0.25": 250000000000000000n,
  "10": 10_000000000000000000n,
  "20": 20_000000000000000000n,
  "250": 250_000000000000000000n,
  "500.25": 500_250000000000000000n,
} as const;

const outcome = (index: number, overrides: Partial<OutcomeDraft> = {}): OutcomeDraft =>
  outcomeDraft({ id: `o${index}`, label: `Director ${index}`, ...overrides });

const AWKWARD: SessionDraft = sessionDraft({
  name: "Which director for Dune: Part Three?",
  outcomes: [
    // Inherits every session setting.
    outcome(0),
    // Overrides every one of them.
    outcome(1, {
      override: true,
      childQuestion: "Worldwide gross, all territories",
      lower: "10",
      upper: "20",
      metricDate: "2099-10-01",
      metricTime: "09:30",
    }),
    // Override ticked, one bound filled: the rest still inherits.
    outcome(2, { override: true, upper: "250" }),
    // Pasted label, hand-written token.
    outcome(3, { label: "  Greta Gerwig  ", token: "GG-2099" }),
  ],
  multi: false,
  category: "business",
  language: "en_GB",
  minBond: "0.25",
  decisionDate: "2099-09-20",
  decisionTime: "12:00",
  template: "Opening weekend gross if {outcome} directs",
  unit: "$M",
  // Exponent notation, which the bound fields emit below 1e-6.
  lower: "1e-7",
  upper: "500.25",
});

const deployed = toDeployInput(AWKWARD);

describe("The decision an awkward draft encodes", () => {
  it("carries the question and the outcomes, each trimmed", () => {
    expect(deployed.parent.marketName).toBe("Which director for Dune: Part Three?");
    expect(deployed.parent.outcomes).toEqual(["Director 0", "Director 1", "Director 2", "Greta Gerwig"]);
  });

  it("names one token per outcome, the written one where there is one", () => {
    expect(deployed.parent.tokenNames).toEqual(["DIRECTOR_0", "DIRECTOR_1", "DIRECTOR_2", "GG-2099"]);
  });

  it("carries the bond, the category, the language and the closing time", () => {
    expect(deployed.parent.minBond).toBe(WEI["0.25"]);
    expect(deployed.parent.category).toBe("business");
    expect(deployed.parent.lang).toBe("en_GB");
    expect(deployed.parent.openingTime).toBe(NOON_20_SEPT_2099);
    expect(deployed.multiCategoricalParent).toBe(false);
  });
});

describe("The branches an awkward draft encodes", () => {
  it("takes the decision's question, range and moment for a branch that inherits", () => {
    expect(deployed.children[0]).toMatchObject({
      parentOutcomeIndex: 0,
      marketName: "Opening weekend gross if Director 0 directs [$M]",
      tokenNames: ["DIRECTOR_0_DOWN", "DIRECTOR_0_UP"],
      lowerBound: WEI["1e-7"],
      upperBound: WEI["500.25"],
      openingTime: NOON_20_SEPT_2099,
      minBond: WEI["0.25"],
    });
  });

  it("takes nothing from the decision for a branch that overrides every field", () => {
    expect(deployed.children[1]).toMatchObject({
      parentOutcomeIndex: 1,
      marketName: "Worldwide gross, all territories [$M]",
      lowerBound: WEI["10"],
      upperBound: WEI["20"],
      openingTime: HALF_PAST_NINE_1_OCT_2099,
    });
  });

  it("falls back to the decision for the bound a half-overridden branch left blank", () => {
    expect(deployed.children[2]).toMatchObject({
      marketName: "Opening weekend gross if Director 2 directs [$M]",
      lowerBound: WEI["1e-7"],
      upperBound: WEI["250"],
      // Overriding the range does not move the moment.
      openingTime: NOON_20_SEPT_2099,
    });
  });

  it("substitutes a pasted label without the spaces around it", () => {
    expect(deployed.children[3]?.marketName).toBe("Opening weekend gross if Greta Gerwig directs [$M]");
  });

  it("names a branch's tokens after the one written by hand", () => {
    expect(deployed.children[3]?.tokenNames).toEqual(["GG-2099_DOWN", "GG-2099_UP"]);
  });

  it("asks every branch as a scalar, in outcome order", () => {
    expect(deployed.children.map((child) => child.parentOutcomeIndex)).toEqual([0, 1, 2, 3]);
    expect(deployed.children.map((child) => child.category)).toEqual(Array(4).fill("business"));
    expect(deployed.children.map((child) => child.minBond)).toEqual(Array(4).fill(WEI["0.25"]));
  });
});
