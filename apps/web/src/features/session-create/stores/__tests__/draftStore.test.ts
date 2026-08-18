import { beforeEach, describe, expect, it } from "vitest";

import { isLegibleBranchColor } from "../../utils/branchColor";
import { useDraftStore } from "../draftStore";

beforeEach(() => {
  localStorage.clear();
  useDraftStore.getState().resetDraft();
});

const store = () => useDraftStore.getState();
const outcomeIds = () => store().draft.outcomes.map((o) => o.id);

/** Reads an outcome by position, failing the test rather than the type checker. */
function outcomeAt(index: number) {
  const outcome = store().draft.outcomes[index];
  if (!outcome) throw new Error(`No outcome at index ${index}`);
  return outcome;
}

describe("draftStore outcomes", () => {
  it("starts with two blank outcomes, each with a legible colour", () => {
    const { outcomes } = store().draft;

    expect(outcomes).toHaveLength(2);
    for (const o of outcomes) {
      expect(o.label).toBe("");
      expect(isLegibleBranchColor(o.color)).toBe(true);
    }
  });

  it("gives every outcome its own id", () => {
    store().addOutcome();

    expect(new Set(outcomeIds()).size).toBe(3);
  });

  it("adds an outcome with a legible colour not already taken", () => {
    store().addOutcome();

    const added = outcomeAt(2);
    expect(store().draft.outcomes).toHaveLength(3);
    expect(isLegibleBranchColor(added.color)).toBe(true);
    expect([outcomeAt(0).color, outcomeAt(1).color]).not.toContain(added.color);
  });

  it("refuses to remove below two outcomes", () => {
    store().removeOutcome(outcomeAt(0).id);

    expect(store().draft.outcomes).toHaveLength(2);
  });

  it("removes an outcome when three exist", () => {
    store().addOutcome();
    const doomed = outcomeAt(1).id;

    store().removeOutcome(doomed);

    expect(outcomeIds()).not.toContain(doomed);
  });

  it("reorders outcomes", () => {
    store().addOutcome();
    const [a, b, c] = [outcomeAt(0).id, outcomeAt(1).id, outcomeAt(2).id];

    store().moveOutcome(c, 0);

    expect(outcomeIds()).toEqual([c, a, b]);
  });

  it("clamps a target index outside the list", () => {
    store().addOutcome();
    const [a, b, c] = [outcomeAt(0).id, outcomeAt(1).id, outcomeAt(2).id];

    store().moveOutcome(c, -1);

    expect(outcomeIds()).toEqual([c, a, b]);
  });

  it("leaves the order alone when only labels are edited", () => {
    const before = outcomeIds();

    store().patchOutcome(outcomeAt(0).id, { label: "Villeneuve" });
    store().patchOutcome(outcomeAt(1).id, { label: "Gerwig" });

    expect(outcomeIds()).toEqual(before);
    expect(store().draft.outcomes.map((o) => o.label)).toEqual(["Villeneuve", "Gerwig"]);
  });
});

describe("draftStore label-driven derivations", () => {
  it("derives the token from the label", () => {
    store().patchOutcome(outcomeAt(0).id, { label: "Greta Gerwig" });

    expect(outcomeAt(0).token).toBe("GRETA_GERWIG");
  });

  it("stops deriving the token once it has been edited by hand", () => {
    const id = outcomeAt(0).id;
    store().setOutcomeToken(id, "GG");

    store().patchOutcome(id, { label: "Someone Else" });

    expect(outcomeAt(0).token).toBe("GG");
  });

  it("keeps displayName following the label", () => {
    store().patchOutcome(outcomeAt(0).id, { label: "Gerwig" });

    expect(outcomeAt(0).displayName).toBe("Gerwig");
  });

  it("stops following the label once displayName diverges from it", () => {
    const id = outcomeAt(0).id;
    store().patchOutcome(id, { displayName: "Greta Gerwig" });

    store().patchOutcome(id, { label: "G. Gerwig" });

    expect(outcomeAt(0).displayName).toBe("Greta Gerwig");
  });
});

describe("draftStore branch overrides", () => {
  it("seeds override fields from the parent when first enabled", () => {
    store().setDraftField("lower", "0");
    store().setDraftField("upper", "500");
    const id = outcomeAt(0).id;

    store().toggleOverride(id);

    expect(outcomeAt(0)).toMatchObject({ override: true, lower: "0", upper: "500" });
  });

  it("writes nothing to the branch when the override is switched off", () => {
    store().setDraftField("lower", "0");
    store().setDraftField("upper", "500");
    const id = outcomeAt(0).id;
    store().toggleOverride(id);
    store().patchOutcome(id, { lower: "", upper: "" });

    store().toggleOverride(id);

    expect(outcomeAt(0)).toMatchObject({ override: false, lower: "", upper: "" });
  });
});

describe("draftStore reset", () => {
  it("returns to a blank draft", () => {
    store().setDraftField("name", "Something");
    store().addOutcome();

    store().resetDraft();

    expect(store().draft.name).toBe("");
    expect(store().draft.outcomes).toHaveLength(2);
  });
});
