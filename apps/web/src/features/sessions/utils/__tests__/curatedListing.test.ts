import { describe, expect, it } from "vitest";

import { legacySessions } from "../curatedListing";
import { NO_FILTERS } from "../listing";

/** 2026-08-01, between the Session 2 and Session 3 trading ends. */
const AUG_2026 = Date.UTC(2026, 7, 1) / 1000;

const names = (sessions: { name: string }[]) => sessions.map(({ name }) => name);

describe("legacySessions", () => {
  it("lists all three movies sessions, each linking out to the legacy UI", () => {
    const sessions = legacySessions(NO_FILTERS, AUG_2026);

    expect(names(sessions)).toEqual([
      "Movies Experiment - Session 3",
      "Movies Experiment - Session 2",
      "Movies Experiment",
    ]);
    expect(sessions.map(({ href }) => href)).toEqual([
      "https://movies-r3.foresight.kleros.io",
      "https://movies-r2.foresight.kleros.io",
      "https://movies.foresight.kleros.io",
    ]);
  });

  it("splits open from closed on the trading end", () => {
    expect(names(legacySessions({ query: "", state: "open" }, AUG_2026))).toEqual(["Movies Experiment - Session 3"]);
    expect(names(legacySessions({ query: "", state: "closed" }, AUG_2026))).toEqual([
      "Movies Experiment - Session 2",
      "Movies Experiment",
    ]);
  });

  it("matches a search term case-insensitively", () => {
    expect(legacySessions({ query: "SESSION 2", state: "all" }, AUG_2026)).toHaveLength(1);
    expect(legacySessions({ query: "devcon", state: "all" }, AUG_2026)).toHaveLength(0);
  });
});
