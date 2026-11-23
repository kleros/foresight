import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GATEWAY } from "@/testing/fixtures";

import { sessionColumns } from "../../utils/__tests__/fixtures";
import { toSessionSummary, type SessionRow } from "../../utils/toSessionSummary";
import { SessionCard } from "../SessionCard";

/**
 * A summary in the Resolved group carries its winning options' names as `winningOptionNames: string[]`, beside
 * `resolved: true`; the card lists them.
 */
const row: SessionRow = {
  ...sessionColumns,
  itemNamePlural: "Talks",
  outcomeCount: "4",
  keyword: "devcon talks",
  openingTime: "1756900800",
};

const WINNERS = ["Scaling with blobs", "Account abstraction today"];
const LOSERS = ["Privacy pools", "MEV in 2027"];

function renderResolvedCard(winningOptionNames: string[]) {
  const session = { ...toSessionSummary(row, GATEWAY), resolved: true, winningOptionNames };
  return render(<SessionCard session={session} />);
}

describe("SessionCard A3 in the Resolved group", () => {
  it("lists every winning option's name and no losing one", () => {
    renderResolvedCard(WINNERS);

    const link = screen.getByRole("link");
    expect(link).toHaveTextContent(row.title!);
    for (const name of WINNERS) expect(link).toHaveTextContent(name);
    for (const name of LOSERS) expect(link).not.toHaveTextContent(name);
  });

  it("lists a single winner by name", () => {
    renderResolvedCard([WINNERS[1]!]);

    const link = screen.getByRole("link");
    expect(link).toHaveTextContent(WINNERS[1]!);
    for (const name of [WINNERS[0]!, ...LOSERS]) expect(link).not.toHaveTextContent(name);
  });
});
