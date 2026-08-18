import { describe, expect, it } from "vitest";

import { outcomeDraft, sessionDraft } from "../../__tests__/support/drafts";
import type { OutcomeDraft, SessionDraft } from "../../types/draft";
import { toDeployInput, toMetadataInput } from "../toDeployInput";

/** The seam between what someone typed and what gets signed, permanent once deployed. */

const outcome = (index: number, overrides: Partial<OutcomeDraft> = {}): OutcomeDraft =>
  outcomeDraft({
    id: `o${index}`,
    label: `Director ${index}`,
    token: `DIRECTOR_${index}`,
    displayName: `Director ${index}`,
    ...overrides,
  });

/** Spells out every field asserted below, so the expected values sit next to their inputs. */
const draft = (overrides: Partial<SessionDraft> = {}): SessionDraft =>
  sessionDraft({
    name: "Which director for Dune: Part Three?",
    outcomes: [outcome(0), outcome(1)],
    category: "misc",
    minBond: "1",
    decisionDate: "2099-09-20",
    decisionTime: "12:00",
    template: "Opening weekend gross if {outcome} directs",
    unit: "$M",
    lower: "0",
    upper: "500",
    title: "Dune: Part Three, director",
    description: "Opening weekend gross per director.",
    itemName: "Director",
    itemNamePlural: "Directors",
    ...overrides,
  });

describe("toDeployInput", () => {
  it("puts the decision question on the parent unchanged", () => {
    expect(toDeployInput(draft()).parent.marketName).toBe("Which director for Dune: Part Three?");
  });

  it("takes outcomes and their token names from the branches, in order", () => {
    const { parent } = toDeployInput(draft());

    expect(parent.outcomes).toEqual(["Director 0", "Director 1"]);
    expect(parent.tokenNames).toEqual(["DIRECTOR_0", "DIRECTOR_1"]);
  });

  it("scales the bond to wei", () => {
    expect(toDeployInput(draft({ minBond: "1.5" })).parent.minBond).toBe(1_500000000000000000n);
  });

  it("makes the decision date the parent opening time, in seconds", () => {
    const { parent } = toDeployInput(draft());

    expect(parent.openingTime).toBe(Math.floor(Date.UTC(2099, 8, 20, 12, 0, 0) / 1000));
  });

  it("composes each child question from the template and appends the unit", () => {
    const { children } = toDeployInput(draft());

    expect(children[0]?.marketName).toBe("Opening weekend gross if Director 0 directs [$M]");
    expect(children[1]?.marketName).toBe("Opening weekend gross if Director 1 directs [$M]");
  });

  it("uses a branch's own question when it overrides the template", () => {
    const overridden = draft({
      outcomes: [outcome(0, { override: true, childQuestion: "Total gross, worldwide" }), outcome(1)],
    });

    expect(toDeployInput(overridden).children[0]?.marketName).toBe("Total gross, worldwide [$M]");
  });

  it("names the two scalar tokens after the branch token", () => {
    expect(toDeployInput(draft()).children[0]?.tokenNames).toEqual(["DIRECTOR_0_DOWN", "DIRECTOR_0_UP"]);
  });

  /** Seer refuses an empty token name, so the label's slug has to stand in. */
  describe("an outcome whose token field was cleared by hand", () => {
    const cleared = draft({
      outcomes: [outcome(0, { label: "Greta Gerwig", token: "", tokenTouched: true }), outcome(1)],
    });

    it("deploys the parent token under the label's slug, never empty", () => {
      expect(toDeployInput(cleared).parent.tokenNames).toEqual(["GRETA_GERWIG", "DIRECTOR_1"]);
    });

    it("names its scalar tokens after the same fallback", () => {
      expect(toDeployInput(cleared).children[0]?.tokenNames).toEqual(["GRETA_GERWIG_DOWN", "GRETA_GERWIG_UP"]);
    });
  });

  it("scales the shared bounds to wei", () => {
    const { children } = toDeployInput(draft());

    expect(children[0]?.lowerBound).toBe(0n);
    expect(children[0]?.upperBound).toBe(500_000000000000000000n);
  });

  it("takes a branch's own bounds when it overrides them", () => {
    const overridden = draft({ outcomes: [outcome(0, { override: true, lower: "10", upper: "20" }), outcome(1)] });
    const { children } = toDeployInput(overridden);

    expect(children[0]?.lowerBound).toBe(10_000000000000000000n);
    expect(children[1]?.upperBound).toBe(500_000000000000000000n);
  });

  it("defaults a branch's metric moment to the decision", () => {
    const { parent, children } = toDeployInput(draft());

    expect(children[0]?.openingTime).toBe(parent.openingTime);
  });

  it("uses a branch's own metric moment when it sets one", () => {
    const overridden = draft({
      outcomes: [outcome(0, { override: true, metricDate: "2099-10-01", metricTime: "09:30" }), outcome(1)],
    });

    expect(toDeployInput(overridden).children[0]?.openingTime).toBe(Math.floor(Date.UTC(2099, 9, 1, 9, 30, 0) / 1000));
  });

  it("numbers children by position", () => {
    expect(toDeployInput(draft()).children.map((c) => c.parentOutcomeIndex)).toEqual([0, 1]);
  });

  it("carries the multi-categorical choice through", () => {
    expect(toDeployInput(draft({ multi: true })).multiCategoricalParent).toBe(true);
  });

  it("refuses a draft that is not ready", () => {
    expect(() => toDeployInput(draft({ minBond: "" }))).toThrow(/bond/i);
    expect(() => toDeployInput(draft({ decisionDate: "" }))).toThrow(/decision/i);
    expect(() => toDeployInput(draft({ upper: "" }))).toThrow(/bound/i);
  });
});

describe("toMetadataInput", () => {
  it("carries the session display fields", () => {
    expect(toMetadataInput(draft())).toMatchObject({
      title: "Dune: Part Three, director",
      description: "Opening weekend gross per director.",
      itemName: "Director",
      itemNamePlural: "Directors",
    });
  });

  it("gives every branch a display entry keyed by its index", () => {
    const { children } = toMetadataInput(draft());

    expect(children).toEqual([
      { outcomeIndex: 0, displayName: "Director 0", color: "#7e1bd4", sections: [""] },
      { outcomeIndex: 1, displayName: "Director 1", color: "#7e1bd4", sections: [""] },
    ]);
  });

  it("falls back to the outcome label when a branch has no display name", () => {
    const unnamed = draft({ outcomes: [outcome(0, { displayName: "  " }), outcome(1)] });

    expect(toMetadataInput(unnamed).children[0]?.displayName).toBe("Director 0");
  });
});
