import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GATEWAY } from "@/testing/fixtures";

import type { SessionSummary } from "../../types";
import { sessionColumns } from "../../utils/__tests__/fixtures";
import { toSessionSummary, type SessionRow } from "../../utils/toSessionSummary";
import { SessionGrid } from "../SessionGrid";

/**
 * `SessionSummary.resolved` is true once the session's parent market has resolved; the grid groups those
 * sessions under a "Resolved" heading, below the sessions still trading.
 */

/** 1 January 2100, so the resolution date is ahead whatever the wall clock reads. */
const FUTURE = "4102444800";
/** 2025-09-03, already past. */
const PAST = "1756900800";

function summary(id: string, title: string, openingTime: string, resolved: boolean): SessionSummary {
  const row: SessionRow = {
    ...sessionColumns,
    id,
    parentMarket: `0x${id.padStart(40, "0")}`,
    title,
    itemNamePlural: "Talks",
    outcomeCount: "3",
    keyword: title.toLowerCase(),
    openingTime,
  };
  return { ...toSessionSummary(row, GATEWAY), resolved };
}

const card = (name: string) => screen.getByRole("link", { name: new RegExp(name) });
const follows = (later: Element, earlier: Element) =>
  Boolean(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("SessionGrid A5 Resolved group", () => {
  it("lists resolved sessions under a Resolved heading, below the sessions still trading", () => {
    render(
      <SessionGrid
        sessions={[
          summary("1", "Resolved early talks", PAST, true),
          summary("2", "Open trading talks", FUTURE, false),
          summary("3", "Resolved late talks", FUTURE, true),
          summary("4", "Past date trading talks", PAST, false),
        ]}
      />,
    );

    const heading = screen.getByRole("heading", { name: "Resolved" });

    for (const name of ["Open trading talks", "Past date trading talks"]) {
      expect(follows(heading, card(name)), `${name} is above the Resolved group`).toBe(true);
    }
    for (const name of ["Resolved early talks", "Resolved late talks"]) {
      expect(follows(card(name), heading), `${name} is in the Resolved group`).toBe(true);
    }
  });

  it("groups a resolved session whose resolution date is still ahead", () => {
    render(
      <SessionGrid
        sessions={[summary("3", "Resolved late talks", FUTURE, true), summary("2", "Open trading talks", FUTURE, false)]}
      />,
    );

    const heading = screen.getByRole("heading", { name: "Resolved" });
    expect(follows(card("Resolved late talks"), heading)).toBe(true);
    expect(follows(heading, card("Open trading talks"))).toBe(true);
  });

  it("keeps every session it was given, each once", () => {
    const sessions = [
      summary("1", "Resolved early talks", PAST, true),
      summary("2", "Open trading talks", FUTURE, false),
      summary("3", "Resolved late talks", FUTURE, true),
    ];
    render(<SessionGrid sessions={sessions} />);

    for (const session of sessions) {
      expect(screen.getAllByRole("link", { name: new RegExp(session.name) })).toHaveLength(1);
    }
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });
});
