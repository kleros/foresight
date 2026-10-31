import { describe, expect, it } from "vitest";

import {
  BOUNDARY_TICK_MS,
  boundarySeconds,
  clearLabel,
  emptyCopy,
  isFiltered,
  keywordPattern,
  NO_FILTERS,
  pageCount,
  PER_PAGE,
  sessionWhere,
} from "../listing";

/** Noon UTC on 20 Aug 2026, in ms. Lands on a tick at any tick size that divides an hour. */
const NOON = Date.UTC(2026, 7, 20, 12, 0, 0);

describe("isFiltered", () => {
  it("is false for the cleared filters", () => {
    expect(isFiltered(NO_FILTERS)).toBe(false);
  });

  it("is false for a search term that is only spaces", () => {
    expect(isFiltered({ query: "   ", state: "all" })).toBe(false);
  });

  it("is true once a search term is typed", () => {
    expect(isFiltered({ query: "dune", state: "all" })).toBe(true);
  });

  it("is true once a state is chosen", () => {
    expect(isFiltered({ query: "", state: "open" })).toBe(true);
  });
});

describe("pageCount", () => {
  it("reports one page when there is nothing to show", () => {
    expect(pageCount(0)).toBe(1);
  });

  it("reports one page for a set that exactly fills it", () => {
    expect(pageCount(PER_PAGE)).toBe(1);
  });

  it("opens a second page for the first session past the first", () => {
    expect(pageCount(PER_PAGE + 1)).toBe(2);
  });
});

describe("keywordPattern", () => {
  it("matches every row when nothing is searched for", () => {
    expect(keywordPattern("")).toBe("%");
  });

  it("wraps a term so it matches anywhere in the keyword", () => {
    expect(keywordPattern("dune")).toBe("%dune%");
  });

  it("trims the term, so a stray space does not become part of it", () => {
    expect(keywordPattern("  dune  ")).toBe("%dune%");
  });

  it("escapes a percent, which would otherwise match everything", () => {
    expect(keywordPattern("100%")).toBe("%100\\%%");
  });

  it("escapes an underscore, which would otherwise match any character", () => {
    expect(keywordPattern("a_b")).toBe("%a\\_b%");
  });

  it("escapes a backslash, so it cannot escape the character after it", () => {
    expect(keywordPattern("a\\b")).toBe("%a\\\\b%");
  });
});

describe("boundarySeconds", () => {
  it("converts to seconds", () => {
    expect(boundarySeconds(NOON)).toBe(NOON / 1000);
  });

  it("holds still for the whole tick, so a key does not churn between them", () => {
    expect(boundarySeconds(NOON + BOUNDARY_TICK_MS - 1)).toBe(boundarySeconds(NOON));
  });

  it("moves on by one tick once the tick does", () => {
    expect(boundarySeconds(NOON + BOUNDARY_TICK_MS)).toBe(boundarySeconds(NOON) + BOUNDARY_TICK_MS / 1000);
  });
});

describe("sessionWhere", () => {
  const boundary = boundarySeconds(NOON);
  // a session trades while its resolution date is ahead, or after it while any of its pools holds liquidity
  const dateAhead = { openingTime: { _gt: String(boundary) } };
  const anyPoolLiquid = { children: { pools: { liquidity: { _gt: "0" } } } };

  it("constrains only the keyword when nothing is filtered", () => {
    expect(sessionWhere(NO_FILTERS, boundary)).toEqual({ keyword: { _ilike: "%" } });
  });

  it("lists a session under Trading while its date is ahead or a pool of it holds liquidity", () => {
    expect(sessionWhere({ query: "", state: "open" }, boundary)).toEqual({
      keyword: { _ilike: "%" },
      _or: [dateAhead, anyPoolLiquid],
    });
  });

  it("lists a session under Closed once its date has passed and none of its pools holds liquidity", () => {
    expect(sessionWhere({ query: "", state: "closed" }, boundary)).toEqual({
      keyword: { _ilike: "%" },
      openingTime: { _lte: String(boundary) },
      _not: anyPoolLiquid,
    });
  });

  it("splits Trading and Closed on the same instant and the same pools, so neither drops a session", () => {
    const open = sessionWhere({ query: "", state: "open" }, boundary);
    const closed = sessionWhere({ query: "", state: "closed" }, boundary);

    expect(open._or?.[0]).toEqual({ openingTime: { _gt: String(boundary) } });
    expect(closed.openingTime).toEqual({ _lte: String(boundary) });
    expect(closed._not).toEqual(open._or?.[1]);
  });

  it("leaves opening time and pools unconstrained under all, which is where an unread date with no liquidity shows", () => {
    const all = sessionWhere({ query: "dune", state: "all" }, boundary);

    expect(all.openingTime).toBeUndefined();
    expect(all._or).toBeUndefined();
    expect(all._not).toBeUndefined();
  });

  it("carries the search term alongside the state", () => {
    expect(sessionWhere({ query: "dune", state: "open" }, boundary)).toEqual({
      keyword: { _ilike: "%dune%" },
      _or: [dateAhead, anyPoolLiquid],
    });
  });
});

describe("emptyCopy", () => {
  it("quotes the search term back when there is one", () => {
    expect(emptyCopy({ query: "dune", state: "all" }).title).toBe("No session matches \u201Cdune\u201D");
  });

  it("names the state instead of quoting an empty term when only a tag is on", () => {
    expect(emptyCopy({ query: "", state: "closed" })).toEqual({
      title: "No closed sessions",
      hint: "Try another status.",
    });
  });

  it("prefers the search term over the state when both are set", () => {
    expect(emptyCopy({ query: "dune", state: "closed" }).title).toBe("No session matches \u201Cdune\u201D");
  });

  it("reads as an empty listing, not a failed filter, when nothing is filtered", () => {
    expect(emptyCopy(NO_FILTERS).title).toBe("No sessions yet");
  });

  it("ignores a term that is only spaces, so the state copy wins", () => {
    expect(emptyCopy({ query: "   ", state: "open" }).title).toBe("No trading sessions");
  });
});

describe("clearLabel", () => {
  it("offers to clear the search when a term is typed", () => {
    expect(clearLabel({ query: "dune", state: "all" })).toBe("Clear search");
  });

  it("offers to clear filters when only a state tag is on", () => {
    expect(clearLabel({ query: "", state: "closed" })).toBe("Clear filters");
  });
});
