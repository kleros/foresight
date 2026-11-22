import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GATEWAY } from "@/testing/fixtures";

import type { SessionSummary } from "../../types";
import { sessionColumns } from "../../utils/__tests__/fixtures";
import { toSessionSummary, type SessionRow } from "../../utils/toSessionSummary";
import { SessionGrid } from "../SessionGrid";

/** A session whose closing date could not be read; the Resolved group goes by `resolved` alone. */
function undated(id: string, title: string, resolved: boolean): SessionSummary {
  const row: SessionRow = {
    ...sessionColumns,
    id,
    parentMarket: `0x${id.padStart(40, "0")}`,
    title,
    itemNamePlural: "Talks",
    outcomeCount: "3",
    keyword: title.toLowerCase(),
  };
  const summary = toSessionSummary(row, GATEWAY);
  return { ...summary, closesAt: null, resolved };
}

const card = (name: string) => screen.getByRole("link", { name: new RegExp(name) });
const follows = (later: Element, earlier: Element) =>
  Boolean(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("SessionGrid A5 Resolved group, for a session with no closing date", () => {
  it("lists a resolved session under Resolved, once, and keeps an unresolved one above", () => {
    render(
      <SessionGrid
        sessions={[undated("1", "Resolved undated talks", true), undated("2", "Trading undated talks", false)]}
      />,
    );

    const heading = screen.getByRole("heading", { name: "Resolved" });
    expect(follows(card("Resolved undated talks"), heading)).toBe(true);
    expect(follows(heading, card("Trading undated talks"))).toBe(true);
    expect(screen.getAllByRole("link", { name: /Resolved undated talks/ })).toHaveLength(1);
  });
});
