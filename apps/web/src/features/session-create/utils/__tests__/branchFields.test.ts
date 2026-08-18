import { describe, expect, it } from "vitest";

import { outcomeDraft, sessionDraft } from "../../__tests__/support/drafts";
import type { OutcomeDraft, SessionDraft } from "../../types/draft";
import {
  branchBoundSources,
  branchBounds,
  branchMarketName,
  branchQuestion,
  branchToken,
  branchTokenPair,
} from "../branchFields";

/**
 * One rule about what a branch inherits and what it overrides, read by the
 * branch list, the review, the assessment and the deploy input. They disagreed
 * once, and only the screens were wrong, which is the version nothing catches.
 */

const outcome = (overrides: Partial<OutcomeDraft> = {}): OutcomeDraft =>
  outcomeDraft({ token: "VILLENEUVE", displayName: "Villeneuve", ...overrides });

const draft = (overrides: Partial<SessionDraft> = {}): SessionDraft =>
  sessionDraft({ outcomes: [outcome()], title: "Dune: Part Three director", ...overrides });

describe("What a branch inherits", () => {
  it("takes the decision's range while it inherits", () => {
    expect(branchBoundSources(draft(), outcome())).toEqual({ lower: "0", upper: "500" });
  });

  it("takes its own range once it overrides", () => {
    const overridden = outcome({ override: true, lower: "10", upper: "20" });

    expect(branchBoundSources(draft(), overridden)).toEqual({ lower: "10", upper: "20" });
  });

  it("keeps the decision's range when it overrides only its closing time", () => {
    const overridden = outcome({ override: true, metricDate: "2099-10-01" });

    expect(branchBoundSources(draft(), overridden)).toEqual({ lower: "0", upper: "500" });
  });

  it("reads a half-filled override one field at a time", () => {
    const overridden = outcome({ override: true, upper: "20" });

    expect(branchBoundSources(draft(), overridden)).toEqual({ lower: "0", upper: "20" });
  });

  it("parses the bounds it resolved, for the screens that show numbers", () => {
    expect(branchBounds(draft({ lower: "0.5" }), outcome())).toEqual({ lower: 0.5, upper: 500 });
  });

  it("asks the decision's question about its own outcome while it inherits", () => {
    expect(branchQuestion(draft(), outcome())).toBe("Opening weekend gross if Villeneuve directs");
  });

  it("asks its own question once it overrides", () => {
    const overridden = outcome({ override: true, childQuestion: "Total gross, worldwide" });

    expect(branchQuestion(draft(), overridden)).toBe("Total gross, worldwide");
  });

  it("falls back to the decision's question when the override is left blank", () => {
    const overridden = outcome({ override: true, childQuestion: "   " });

    expect(branchQuestion(draft(), overridden)).toBe("Opening weekend gross if Villeneuve directs");
  });

  it("appends the unit only to the composed market name", () => {
    expect(branchMarketName(draft(), outcome())).toBe("Opening weekend gross if Villeneuve directs [$M]");
  });
});

describe("The token name a branch deploys under", () => {
  it("takes the token the creator wrote, unchanged", () => {
    expect(branchToken(outcome({ token: "DUNE3-DV" }))).toBe("DUNE3-DV");
  });

  it("falls back to the label's slug when no token was written", () => {
    expect(branchToken(outcome({ token: "", label: "Greta Gerwig" }))).toBe("GRETA_GERWIG");
  });

  it("falls back when the token is only whitespace", () => {
    expect(branchToken(outcome({ token: "   ", label: "Gerwig" }))).toBe("GERWIG");
  });

  it("is empty when the label slugs away to nothing and no token was written", () => {
    expect(branchToken(outcome({ token: "", label: "北京" }))).toBe("");
  });

  it("names both scalar tokens after it", () => {
    expect(branchTokenPair(outcome({ token: "DV" }))).toEqual(["DV_DOWN", "DV_UP"]);
  });

  it("names the scalar tokens after the fallback too, never after an empty field", () => {
    expect(branchTokenPair(outcome({ token: "", label: "Gerwig" }))).toEqual(["GERWIG_DOWN", "GERWIG_UP"]);
  });
});
