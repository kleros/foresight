import { render, screen } from "@testing-library/react";
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

describe("SessionHeader A2 on a resolved session shows its status, not a list of selected options", () => {
  it("one winner: Resolved, and no Selected option list naming it or its answer", () => {
    const header = renderHeader({
      invalidPayouts: null,
      winners: [VILLENEUVE],
      options: { [VILLENEUVE.market.toLowerCase()]: final("312.5 $M") },
    });

    expect(header).toHaveTextContent("Resolved");
    expect(header).not.toHaveTextContent(/Selected options?/);
    expect(header).not.toHaveTextContent(VILLENEUVE.name);
    expect(header).not.toHaveTextContent("312.5 $M");
  });

  it("two winners: Resolved, and no Selected options list naming either", () => {
    const header = renderHeader({
      invalidPayouts: null,
      winners: [VILLENEUVE, GERWIG],
      options: {
        [VILLENEUVE.market.toLowerCase()]: final("312.5 $M"),
        [GERWIG.market.toLowerCase()]: { kind: "waiting" },
      },
    });

    expect(header).toHaveTextContent("Resolved");
    expect(header).not.toHaveTextContent(/Selected options?/);
    for (const winner of [VILLENEUVE, GERWIG]) expect(header).not.toHaveTextContent(winner.name);
    expect(header).not.toHaveTextContent("312.5 $M");
    expect(header).not.toHaveTextContent("Waiting for result");
  });

  it("a winner whose answer is still being read leaves no list and no placeholder for it", () => {
    const header = renderHeader({
      invalidPayouts: null,
      winners: [VILLENEUVE],
      options: { [VILLENEUVE.market.toLowerCase()]: { kind: "loading" } },
    });

    expect(header).toHaveTextContent("Resolved");
    expect(header).not.toHaveTextContent(/Selected options?/);
    expect(header).not.toHaveTextContent(VILLENEUVE.name);
  });

  it("an INVALID parent still reads Invalid, with what each of its tokens pays", () => {
    const header = renderHeader({
      invalidPayouts: "Pays per token: each option 0, INVALID 1",
      winners: [],
      options: {},
    });

    expect(header).toHaveTextContent("Resolved");
    expect(header).toHaveTextContent("Invalid");
    expect(header).toHaveTextContent("Pays per token: each option 0, INVALID 1");
    expect(header).not.toHaveTextContent(/Selected options?/);
  });
});
