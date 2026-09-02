import { describe, expect, it } from "vitest";

import { GATEWAY } from "@/testing/fixtures";

import { type SessionRow, toSessionSummary } from "../toSessionSummary";
import { sessionColumns } from "./fixtures";

function row(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    ...sessionColumns,
    itemNamePlural: "Directors",
    outcomeCount: "3",
    keyword: "dune part three director",
    ...overrides,
  };
}

describe("toSessionSummary", () => {
  it("names a session by its metadata title", () => {
    expect(toSessionSummary(row(), GATEWAY).name).toBe("Dune: Part Three, director");
  });

  it("falls back to the parent market name when metadata carried no title", () => {
    expect(toSessionSummary(row({ title: null }), GATEWAY).name).toBe(row().marketName);
  });

  it("describes a session from its metadata description", () => {
    expect(toSessionSummary(row(), GATEWAY).description).toBe(row().description);
  });

  /** The name already reads as the question; the market name is the parent's, shown nowhere yet. */
  it("leaves the description empty rather than falling back to the parent market name", () => {
    expect(toSessionSummary(row({ description: null }), GATEWAY).description).toBeNull();
  });

  it("counts branches from the outcome count", () => {
    expect(toSessionSummary(row({ outcomeCount: "12" }), GATEWAY).branchCount).toBe(12);
  });

  it("names branches by the metadata plural", () => {
    expect(toSessionSummary(row({ itemNamePlural: "Properties" }), GATEWAY).branchNoun).toBe("Properties");
  });

  it("falls back to a generic branch noun when metadata carried none", () => {
    expect(toSessionSummary(row({ itemNamePlural: null }), GATEWAY).branchNoun).toBe("Branches");
  });

  it("resolves an IPFS icon against the gateway it was given", () => {
    expect(toSessionSummary(row({ icon: "ipfs://QmIcon" }), GATEWAY).iconUri).toBe(`${GATEWAY}/QmIcon`);
  });

  it("resolves an IPFS hero image against the gateway it was given", () => {
    expect(toSessionSummary(row({ heroImage: "ipfs://QmHero" }), GATEWAY).heroUri).toBe(`${GATEWAY}/QmHero`);
  });

  it("reports no image where the session carries none", () => {
    const summary = toSessionSummary(row({ icon: null, heroImage: null }), GATEWAY);

    expect([summary.iconUri, summary.heroUri]).toEqual([null, null]);
  });

  it("drops an image uri the gateway would refuse rather than throwing the card away", () => {
    expect(toSessionSummary(row({ icon: "javascript:alert(1)" }), GATEWAY).iconUri).toBeNull();
  });

  it("closes a session at the market's opening time", () => {
    expect(toSessionSummary(row({ openingTime: "1756900800" }), GATEWAY).closesAt?.getTime()).toBe(1756900800 * 1000);
  });

  it("reports no closing time where the indexer could not read one off Reality", () => {
    expect(toSessionSummary(row({ openingTime: null }), GATEWAY).closesAt).toBeNull();
  });
});
