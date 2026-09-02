import { describe, expect, it } from "vitest";

import { branchColor } from "@/utils/branchColor";

import { addresses, dune, GATEWAY } from "@/testing/fixtures";

import { sessionStatus, type SessionDetailRow, toSessionDetail } from "../toSessionDetail";
import { sessionColumns } from "./fixtures";

type ChildRow = SessionDetailRow["children"][number];

function child(overrides: Partial<ChildRow> = {}): ChildRow {
  return {
    id: addresses.childMarkets[0],
    parentOutcomeIndex: "1",
    parentOutcome: dune.director.outcome,
    marketName: dune.director.marketName,
    lowerBound: dune.director.lowerBound,
    upperBound: dune.director.upperBound,
    displayName: dune.director.displayName,
    color: dune.director.color,
    blocks: [],
    upToken: addresses.upToken,
    downToken: addresses.downToken,
    underlyingToken: addresses.underlyingToken,
    ...overrides,
  };
}

function row(overrides: Partial<SessionDetailRow> = {}): SessionDetailRow {
  return {
    ...sessionColumns,
    itemName: "Director",
    itemNamePlural: "Directors",
    metadataResolved: true,
    outcomeCount: "3",
    deployedChildCount: "3",
    openedAt: "1756000000",
    completedAt: "1756000600",
    blocks: [],
    children: [child()],
    ...overrides,
  };
}

describe("toSessionDetail", () => {
  it("names a session by its metadata title", () => {
    expect(toSessionDetail(row(), GATEWAY).name).toBe("Dune: Part Three, director");
  });

  it("falls back to the parent market name when metadata carried no title", () => {
    expect(toSessionDetail(row({ title: null }), GATEWAY).name).toBe(row().marketName);
  });

  it("carries the parent's question separately from the display title", () => {
    expect(toSessionDetail(row(), GATEWAY).question).toBe("Which director for Dune: Part Three?");
  });

  it("resolves the hero image against the gateway it was given", () => {
    expect(toSessionDetail(row({ heroImage: "ipfs://QmHero" }), GATEWAY).heroUri).toBe(`${GATEWAY}/QmHero`);
  });

  it("reports unfinished setup while the completion timestamp is still zero", () => {
    expect(toSessionDetail(row({ completedAt: "0" }), GATEWAY).setupComplete).toBe(false);
  });

  it("reports finished setup once the factory stamped a completion time", () => {
    expect(toSessionDetail(row(), GATEWAY).setupComplete).toBe(true);
  });

  it("closes a session at the market's opening time", () => {
    expect(toSessionDetail(row(), GATEWAY).closesAt?.getTime()).toBe(1756900800 * 1000);
  });

  it("reports no closing time where the indexer could not read one off Reality", () => {
    expect(toSessionDetail(row({ openingTime: null }), GATEWAY).closesAt).toBeNull();
  });

  it("names an option by its metadata display name", () => {
    expect(toSessionDetail(row(), GATEWAY).options[0]?.name).toBe("Greta Gerwig");
  });

  it("falls back to the chain's outcome string when metadata carried no name", () => {
    const detail = toSessionDetail(row({ children: [child({ displayName: null })] }), GATEWAY);

    expect(detail.options[0]?.name).toBe("Gerwig");
  });

  it("colours an option by its metadata colour", () => {
    expect(toSessionDetail(row(), GATEWAY).options[0]?.color).toBe("#009aff");
  });

  it("falls back to the generated palette when metadata carried no colour", () => {
    const detail = toSessionDetail(row({ children: [child({ color: null })] }), GATEWAY);

    expect(detail.options[0]?.color).toBe(branchColor(1));
  });

  /** The document is hostile input and the indexer only checks it is a string. */
  it("refuses a colour that is not a plain hex colour", () => {
    const detail = toSessionDetail(row({ children: [child({ color: "url(javascript:1)" })] }), GATEWAY);

    expect(detail.options[0]?.color).toBe(branchColor(1));
  });

  it("refuses a colour that would not render legibly", () => {
    const detail = toSessionDetail(row({ children: [child({ color: "#ffffff" })] }), GATEWAY);

    expect(detail.options[0]?.color).toBe(branchColor(1));
  });

  it("splits the unit out of the option's market name", () => {
    const option = toSessionDetail(row(), GATEWAY).options[0];

    expect([option?.question, option?.unit]).toEqual(["Opening weekend gross if Gerwig directs", "$M"]);
  });

  it("de-scales the 1e18 bounds into the unit's own terms", () => {
    const option = toSessionDetail(row(), GATEWAY).options[0];

    expect([option?.lowerBound, option?.upperBound]).toEqual([0, 500]);
  });

  it("reports no token where the on-chain read failed at indexing time", () => {
    const detail = toSessionDetail(row({ children: [child({ upToken: "" })] }), GATEWAY);

    expect(detail.options[0]?.upToken).toBeNull();
  });
});

describe("sessionStatus", () => {
  const before = new Date(1756900800 * 1000 - 1);
  const at = new Date(1756900800 * 1000);

  it("reports a session setting up ahead of anything else", () => {
    expect(sessionStatus({ setupComplete: false, closesAt: before }, at)).toBe("setting-up");
  });

  it("reports trading before the closing time", () => {
    expect(sessionStatus({ setupComplete: true, closesAt: at }, before)).toBe("trading");
  });

  it("closes at the closing time exactly", () => {
    expect(sessionStatus({ setupComplete: true, closesAt: at }, at)).toBe("closed");
  });

  it("never closes a session whose closing time could not be read", () => {
    expect(sessionStatus({ setupComplete: true, closesAt: null }, at)).toBe("trading");
  });
});
