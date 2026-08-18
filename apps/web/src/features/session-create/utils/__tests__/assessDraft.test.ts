import { describe, expect, it } from "vitest";

import { outcomeDraft, sessionDraft } from "../../__tests__/support/drafts";
import type { OutcomeDraft, SessionDraft } from "../../types/draft";
import { assessDraft, LONG_RUN_NOTE } from "../assessDraft";

/** A moment safely before the draft's decision date. */
const NOW = new Date("2026-08-04T10:00:00Z");

const outcome = (partial: Partial<OutcomeDraft> & { id: string; label: string }): OutcomeDraft =>
  outcomeDraft({ displayName: partial.label, ...partial });

/** Dated near NOW, since half of step 1 is about the decision still being ahead of it. */
const validDraft = (overrides: Partial<SessionDraft> = {}): SessionDraft =>
  sessionDraft({
    outcomes: [
      outcome({ id: "a", label: "Villeneuve", color: "#9013fe" }),
      outcome({ id: "b", label: "Gerwig", color: "#009aff" }),
    ],
    decisionDate: "2026-08-20",
    ...overrides,
  });

/** A valid draft with its second branch altered, so the arrange stays one expression. */
function draftWithSecondBranch(branch: Partial<OutcomeDraft>): SessionDraft {
  return validDraft({
    outcomes: [
      outcome({ id: "a", label: "Villeneuve", color: "#9013fe" }),
      outcome({ id: "b", label: "Gerwig", color: "#009aff", ...branch }),
    ],
  });
}

const texts = (draft: SessionDraft) => assessDraft(draft, NOW).issues.map((i) => i.text);
const warnings = (draft: SessionDraft) => assessDraft(draft, NOW).warnings.map((w) => w.text);

describe("assessDraft, a valid draft", () => {
  it("raises no issues and marks every step ready", () => {
    const a = assessDraft(validDraft(), NOW);

    expect(a.issues).toEqual([]);
    expect(a.steps).toEqual({ parent: true, children: true, display: true });
    expect(a.branchOk).toEqual([true, true]);
  });
});

describe("assessDraft, step 1, decision market", () => {
  it("requires a decision question", () => {
    const a = assessDraft(validDraft({ name: "  " }), NOW);

    expect(a.issues).toContainEqual({ step: 1, text: "The decision has no question." });
    expect(a.steps.parent).toBe(false);
  });

  it("rejects square brackets in the question", () => {
    expect(texts(validDraft({ name: "Gross [in $M]?" }))).toContainEqual(expect.stringContaining("square brackets"));
  });

  it("flags an unnamed outcome", () => {
    expect(texts(draftWithSecondBranch({ label: "" }))).toContainEqual("An outcome is unnamed.");
  });

  it("flags duplicate outcomes by name", () => {
    expect(texts(draftWithSecondBranch({ label: "villeneuve " }))).toContainEqual(
      'Two outcomes are both called "villeneuve".',
    );
  });

  it("flags token collisions after slugging", () => {
    const draft = validDraft({
      outcomes: [
        outcome({ id: "a", label: "Villeneuve", token: "DIR" }),
        outcome({ id: "b", label: "Gerwig", token: "dir" }),
      ],
    });

    expect(texts(draft)).toContainEqual("Two token names are both DIR.");
  });

  it("flags an outcome that slugs away to no token name at all", () => {
    // Seer names each outcome's ERC20 from this and refuses an empty one, so a
    // label with no A-Z or 0-9 in it has to be given a token by hand.
    const draft = validDraft({
      outcomes: [outcome({ id: "a", label: "北京" }), outcome({ id: "b", label: "Gerwig" })],
    });

    expect(texts(draft)).toContainEqual('"北京" gives no token name. Write one under advanced settings.');
  });

  it("flags a quote in the decision, which Reality substitutes into JSON unescaped", () => {
    expect(texts(validDraft({ name: 'Which "director" for Dune?' }))).toContainEqual(
      "The decision contains a quote or a backslash, which would break the question Reality.eth asks. Remove it.",
    );
  });

  it("flags a quote in an outcome, which is quoted again inside the question", () => {
    const draft = validDraft({
      outcomes: [outcome({ id: "a", label: 'Denis "DV" Villeneuve' }), outcome({ id: "b", label: "Gerwig" })],
    });

    expect(texts(draft)).toContainEqual(
      '"Denis "DV" Villeneuve" contains a quote or a backslash, which would break the question Reality.eth asks. Remove it.',
    );
  });

  it("flags the field separator Reality splits its question on", () => {
    expect(texts(validDraft({ name: "Which director␟for Dune?" }))).toContainEqual(
      "The decision contains a quote or a backslash, which would break the question Reality.eth asks. Remove it.",
    );
  });

  it("leaves an apostrophe alone, which the encoding does not care about", () => {
    const texted = texts(validDraft({ name: "Which director for Villeneuve's Dune?" }));

    expect(texted.filter((text) => text.includes("Reality.eth asks"))).toEqual([]);
  });

  it("accepts a name in another script once its token is written out", () => {
    const draft = validDraft({
      outcomes: [outcome({ id: "a", label: "北京", token: "BEIJING" }), outcome({ id: "b", label: "Gerwig" })],
    });

    expect(texts(draft).filter((text) => text.includes("token"))).toEqual([]);
  });

  it("passes an outcome whose token was cleared by hand, since the label's slug stands in", () => {
    const draft = validDraft({
      outcomes: [
        outcome({ id: "a", label: "Villeneuve", token: "", tokenTouched: true }),
        outcome({ id: "b", label: "Gerwig" }),
      ],
    });

    expect(texts(draft)).toEqual([]);
  });

  it("flags a token name too long for Seer to wrap once _DOWN is added", () => {
    const draft = validDraft({
      outcomes: [
        outcome({ id: "a", label: "Villeneuve", token: "A_TOKEN_NAME_THAT_IS_FAR_TOO_LONG" }),
        outcome({ id: "b", label: "Gerwig" }),
      ],
    });

    expect(texts(draft)).toContainEqual(expect.stringContaining("is too long"));
  });

  it("accepts a token name that exactly fills the room a branch suffix leaves", () => {
    const draft = validDraft({
      outcomes: [
        // 26 bytes, so `_DOWN` brings it to Seer's 31.
        outcome({ id: "a", label: "Villeneuve", token: "A".repeat(26) }),
        outcome({ id: "b", label: "Gerwig" }),
      ],
    });

    expect(texts(draft).filter((text) => text.includes("too long"))).toEqual([]);
  });

  it("requires a positive bond", () => {
    expect(texts(validDraft({ minBond: "0" }))).toContainEqual("The minimum bond must be above zero.");
    expect(texts(validDraft({ minBond: "" }))).toContainEqual("The minimum bond must be above zero.");
  });

  it("requires the decision moment to be in the future", () => {
    expect(texts(validDraft({ decisionDate: "2026-08-01" }))).toContainEqual("Trading would close in the past.");
  });

  // The drafts close at 12:00, NOW is 10:00, so LONG_RUN_DAYS out lands two hours into 2026-09-03.
  it("warns about a session running past the long-run mark, without blocking it", () => {
    const draft = validDraft({ decisionDate: "2026-09-04" });

    expect(warnings(draft)).toContainEqual(expect.stringContaining(LONG_RUN_NOTE));
    expect(texts(draft)).toEqual([]);
  });

  it("says nothing about a session that closes just inside the mark", () => {
    expect(warnings(validDraft({ decisionDate: "2026-09-02" }))).not.toContainEqual(
      expect.stringContaining(LONG_RUN_NOTE),
    );
  });
});

describe("assessDraft, step 2, branch markets", () => {
  it("requires a template containing {outcome}", () => {
    expect(texts(validDraft({ template: "" }))).toContainEqual("No question template.");
    expect(texts(validDraft({ template: "Gross for the film" }))).toContainEqual(
      "The template has no {outcome} in it.",
    );
  });

  it("rejects square brackets in the template", () => {
    expect(texts(validDraft({ template: "Gross for {outcome} [$M]" }))).toContainEqual(
      expect.stringContaining("square brackets"),
    );
  });

  it("requires a unit with no spaces and no brackets", () => {
    expect(texts(validDraft({ unit: "" }))).toContainEqual("No unit. Reality.eth would be guessing at the scale.");
    expect(texts(validDraft({ unit: "$ M" }))).toContainEqual(expect.stringContaining("unit"));
  });

  it("rejects a negative lower bound", () => {
    expect(texts(validDraft({ lower: "-5" }))).toContainEqual(expect.stringContaining("negative lower bound"));
  });

  it("requires the lower bound strictly below the upper", () => {
    expect(texts(validDraft({ lower: "500", upper: "500" }))).toContainEqual(
      expect.stringContaining("lower bound is not below the upper"),
    );
  });

  it("refuses a bound the deploy could not scale, which a float parse would take the front of", () => {
    expect(texts(validDraft({ upper: "500abc" }))).toContainEqual(
      expect.stringContaining("upper bound is not a plain number"),
    );
  });

  it("says a bound is not set rather than calling an empty one a bad number", () => {
    expect(texts(validDraft({ upper: "" }))).toContainEqual(expect.stringContaining("upper bound is not set"));
  });

  it("still reads a bound in the exponent notation the field produces on its own", () => {
    expect(texts(validDraft({ lower: "1e-7", upper: "1e+21" }))).toEqual([]);
  });

  it("checks overridden branch bounds, not just the shared ones", () => {
    const draft = draftWithSecondBranch({
      override: true,
      childQuestion: "Worldwide gross for Gerwig",
      lower: "10",
      upper: "5",
    });

    const a = assessDraft(draft, NOW);

    expect(a.issues.map((i) => i.text)).toContainEqual(expect.stringContaining("lower bound is not below the upper"));
    expect(a.branchOk).toEqual([true, false]);
  });

  it("keeps every branch's metric moment at or after the decision", () => {
    const draft = draftWithSecondBranch({
      override: true,
      childQuestion: "Worldwide gross for Gerwig",
      lower: "0",
      upper: "500",
      metricDate: "2026-08-19",
      metricTime: "12:00",
    });

    expect(texts(draft)).toContainEqual("Gerwig closes before the decision does.");
  });

  it("warns about an overridden branch that runs past the long-run mark", () => {
    const draft = draftWithSecondBranch({ override: true, metricDate: "2026-09-04" });

    expect(warnings(draft)).toContainEqual(`Gerwig ${LONG_RUN_NOTE}.`);
  });

  it("leaves a branch that only inherits the decision's date out of the long-run warning", () => {
    const draft = validDraft({ decisionDate: "2026-09-04" });

    expect(warnings(draft).filter((text) => text.startsWith("Villeneuve"))).toEqual([]);
  });
});

/** A unit is appended to the question, not a field, so it is warned about rather than refused. */
describe("assessDraft, units", () => {
  it("says nothing about a listed unit whose bounds sit where it implies", () => {
    expect(warnings(validDraft({ unit: "%", lower: "0", upper: "100" }))).toEqual([]);
  });

  it("warns when the bounds run past what the unit spans, without blocking", () => {
    const draft = validDraft({ unit: "%", lower: "0", upper: "500" });

    expect(warnings(draft)).toContainEqual(expect.stringContaining("outside the 0 to 100"));
    expect(texts(draft)).toEqual([]);
    expect(assessDraft(draft, NOW).steps.children).toBe(true);
  });

  it("warns that an unlisted unit cannot be checked against the bounds", () => {
    expect(warnings(validDraft({ unit: "TWh" }))).toContainEqual(
      expect.stringContaining("not one of the listed units"),
    );
  });

  it("warns that a suffixed unit carries a multiplier the bounds have to match", () => {
    expect(warnings(validDraft({ unit: "$M" }))).toContainEqual(expect.stringContaining("carries a multiplier"));
  });

  it("still refuses a unit Reality could not be asked, rather than warning about it", () => {
    expect(texts(validDraft({ unit: "$ M" }))).toContainEqual("The unit is just the symbol: no brackets, no spaces.");
  });

  it("leaves a unit warning out of the branch readiness the rail draws", () => {
    expect(assessDraft(validDraft({ unit: "$M" }), NOW).branchOk).toEqual([true, true]);
  });

  it("marks the branches whose bounds run past the unit, so the rail can dot them", () => {
    const draft = validDraft({ unit: "%", lower: "0", upper: "500" });

    expect(assessDraft(draft, NOW).branchWarn).toEqual([true, true]);
    expect(assessDraft(draft, NOW).branchOk).toEqual([true, true]);
  });

  it("leaves a session-wide unit warning off the branch dots, which it says nothing about", () => {
    expect(assessDraft(validDraft({ unit: "$M" }), NOW).branchWarn).toEqual([false, false]);
  });
});

describe("assessDraft, step 3, display metadata", () => {
  it("requires a title", () => {
    const a = assessDraft(validDraft({ title: "" }), NOW);

    expect(a.issues).toContainEqual({ step: 3, text: "The session has no title." });
    expect(a.steps.display).toBe(false);
  });

  it("requires a description, a hero image and an icon", () => {
    const issues = texts(validDraft({ description: "", heroImageName: null, iconName: null }));

    expect(issues).toContainEqual(expect.stringContaining("description"));
    expect(issues).toContainEqual(expect.stringContaining("hero image"));
    expect(issues).toContainEqual(expect.stringContaining("icon"));
  });

  it("rejects a branch colour that fails the contrast floor", () => {
    const draft = validDraft({
      outcomes: [
        outcome({ id: "a", label: "Villeneuve", color: "#ffffff" }),
        outcome({ id: "b", label: "Gerwig", color: "#009aff" }),
      ],
    });

    expect(texts(draft)).toContainEqual("Villeneuve has a colour that is not legible in both themes.");
  });
});
