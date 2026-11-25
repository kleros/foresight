import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { RealisedPnl } from "@/features/resolution/utils/realisedPnl";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";
import { toSessionDetail } from "@/features/sessions/utils/toSessionDetail";

import { GATEWAY } from "@/testing/fixtures";

import { SessionHeader } from "../SessionHeader";

const CENT = 10n ** 16n;

function renderHeader(pnl: RealisedPnl["session"]) {
  render(
    <SessionHeader
      session={toSessionDetail({ ...sessionDetailColumns, children: [sessionChildRow()] }, GATEWAY)}
      status="resolved"
      stats={undefined}
      statsPending={false}
      poolBalances={undefined}
      poolBalancesPending={false}
      usdPrice={undefined}
      pnl={pnl}
    />,
  );
  return screen.getByRole("heading", { level: 1 }).closest("header") as HTMLElement;
}

describe("SessionHeader P&L (spec D21)", () => {
  it("shows what went in and what came back, then the signed P&L", () => {
    const header = renderHeader({ cost: 200n * CENT, payout: 323n * CENT, pnl: 123n * CENT, waiting: [] });

    expect(header).toHaveTextContent("2.00 sDAI→3.23 sDAIP&L:+1.23 sDAI");
    expect(screen.getByText("Put in 2.00 sDAI, back 3.23 sDAI, profit 1.23 sDAI")).toHaveClass("sr-only");
  });
});
