import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { OptionResult, SessionResults } from "@/features/resolution/utils/sessionResults";
import type { SessionOption } from "@/features/sessions/types";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";
import { toSessionDetail } from "@/features/sessions/utils/toSessionDetail";

import { addresses, GATEWAY } from "@/testing/fixtures";

import { SessionHeader } from "../SessionHeader";

const session = toSessionDetail(
  {
    ...sessionDetailColumns,
    children: [
      sessionChildRow({
        id: addresses.childMarkets[0],
        parentOutcomeIndex: "0",
        parentOutcome: "Denis Villeneuve",
        displayName: "Denis Villeneuve",
      }),
      sessionChildRow({
        id: addresses.childMarkets[1],
        parentOutcomeIndex: "1",
        parentOutcome: "Greta Gerwig",
        displayName: "Greta Gerwig",
      }),
    ],
  },
  GATEWAY,
);
const named = (name: string) => session.options.find((option) => option.name === name)!;
const VILLENEUVE = named("Denis Villeneuve");
const GERWIG = named("Greta Gerwig");

function renderHeader(results: SessionResults<SessionOption>) {
  render(
    <SessionHeader
      session={session}
      status="resolved"
      stats={undefined}
      statsPending={false}
      poolBalances={undefined}
      poolBalancesPending={false}
      usdPrice={undefined}
      results={results}
    />,
  );
  return screen.getByRole("heading", { level: 1 }).closest("header") as HTMLElement;
}

const final = (text: string): OptionResult => ({ kind: "final", text, share: 0.5 });

describe("SessionHeader answers under the question (spec D20)", () => {
  const answers = (header: HTMLElement) => within(header).getByRole("list", { name: "Results" });

  it("reads an INVALID session as Invalid, its token payouts beside it", () => {
    const header = renderHeader({
      invalidPayouts: "Pays per token: each option 0, INVALID 1",
      winners: [],
      options: {},
    });

    expect(answers(header)).toHaveTextContent("Invalid");
    expect(answers(header)).toHaveTextContent("Pays per token: each option 0, INVALID 1");
  });

  it("reads a winner whose own market resolved INVALID as Invalid, and a failed read as Result unknown", () => {
    const header = renderHeader({
      invalidPayouts: null,
      winners: [VILLENEUVE, GERWIG],
      options: {
        [VILLENEUVE.market.toLowerCase()]: { kind: "invalid", payouts: "Pays per token: UP 0, DOWN 0, INVALID 1" },
        [GERWIG.market.toLowerCase()]: { kind: "unread" },
      },
    });

    expect(
      within(answers(header))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([`${VILLENEUVE.name}Invalid`, `${GERWIG.name}Result unknown`]);
  });

  it("wraps its answers rather than pushing the card wider", () => {
    const header = renderHeader({
      invalidPayouts: null,
      winners: [VILLENEUVE],
      options: { [VILLENEUVE.market.toLowerCase()]: final("312.5 $M") },
    });

    expect(answers(header)).toHaveClass("flex-wrap");
  });
});
