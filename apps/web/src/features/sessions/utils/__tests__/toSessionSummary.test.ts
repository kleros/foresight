import { describe, expect, it } from "vitest";

import { type SessionRow, toSessionSummary } from "../toSessionSummary";

const GATEWAY = "https://cdn.example.link/ipfs";

/** Every field spelled out: the assertions below turn on these values. */
function row(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "1",
    parentMarket: "0xaa01",
    deployer: "0x4a3f1d2b9c8e7f6a5b4c3d2e1f0a9b8c7d6e5f19",
    marketName: "What would opening weekend be, in $M, under each director?",
    title: "Dune: Part Three — director",
    description: "Three directors, one weekend. Trade the branch you believe in.",
    icon: null,
    heroImage: null,
    itemNamePlural: "Directors",
    outcomeCount: "3",
    keyword: "dune part three director",
    openingTime: "1756900800",
    ...overrides,
  };
}

describe("toSessionSummary", () => {
  it("names a session by its metadata title", () => {
    expect(toSessionSummary(row(), GATEWAY).name).toBe("Dune: Part Three — director");
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

  it("carries the deployer through for the card to address the session by", () => {
    expect(toSessionSummary(row(), GATEWAY).deployer).toBe(row().deployer);
  });

  it("closes a session at the market's opening time", () => {
    expect(toSessionSummary(row({ openingTime: "1756900800" }), GATEWAY).closesAt?.getTime()).toBe(1756900800 * 1000);
  });

  it("reports no closing time where the indexer could not read one off Reality", () => {
    expect(toSessionSummary(row({ openingTime: null }), GATEWAY).closesAt).toBeNull();
  });
});
