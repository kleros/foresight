import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { OptionResult } from "@/features/resolution/utils/sessionResults";
import type { SessionOption } from "@/features/sessions/types";

import { addresses } from "@/testing/fixtures";

import { OptionCard } from "../OptionCard";

const option: SessionOption = {
  market: addresses.childMarkets[0],
  outcomeIndex: 0,
  name: "Denis Villeneuve",
  color: "#009aff",
  question: "Opening weekend gross if Villeneuve directs",
  unit: "$M",
  lowerBound: 0,
  upperBound: 500,
  upToken: addresses.upToken,
  invalidToken: addresses.childInvalidToken,
  downToken: addresses.downToken,
  underlyingToken: addresses.underlyingToken,
  blocks: [],
};
const CENT = 10n ** 16n;

type Figures = { cost: bigint; payout: bigint };

function titleRow(result: OptionResult, pnl?: Figures): HTMLElement {
  render(
    <OptionCard
      option={option}
      parentMarket={addresses.parentMarket}
      status="resolved"
      marketEstimate={250}
      isMarketPending={false}
      result={result}
      pnl={pnl}
    />,
  );
  return screen.getByRole("heading", { level: 3, name: option.name }).closest("button[aria-expanded]") as HTMLElement;
}

describe("OptionCard title row on a resolved session", () => {
  it("shows a winner's P&L beside its result, after what went in and what came back (spec D21)", () => {
    const row = titleRow(
      { kind: "final", text: "312.5 $M", share: 0.625 },
      { cost: 500n * CENT, payout: 1225n * CENT },
    );

    expect(row).toHaveTextContent("Result 312.5 $M");
    expect(row).toHaveTextContent("5.00 sDAI→12.25 sDAI+7.25 sDAI");
    expect(within(row).getByText("Put in 5.00 sDAI, back 12.25 sDAI, profit 7.25 sDAI")).toHaveClass("sr-only");
  });

  it("shows a Not selected option's loss", () => {
    const row = titleRow({ kind: "not-selected" }, { cost: 475n * CENT, payout: 0n });

    expect(row).toHaveTextContent("4.75 sDAI→0.00 sDAI-4.75 sDAI");
  });

  it("shows no P&L and no estimate mark where it has none", () => {
    const row = titleRow({ kind: "not-selected" });

    expect(row).not.toHaveTextContent(/profit|loss|sDAI/);
    expect(screen.queryByRole("img", { name: "Estimate set" })).toBeNull();
  });

  it("reads a failed result read as Result unknown", () => {
    expect(titleRow({ kind: "unread" })).toHaveTextContent("Result unknown");
  });

  it("shows no label while the result is read", () => {
    const row = titleRow({ kind: "loading" });

    expect(row).toHaveTextContent(new RegExp(`^${option.name}$`));
  });
});
