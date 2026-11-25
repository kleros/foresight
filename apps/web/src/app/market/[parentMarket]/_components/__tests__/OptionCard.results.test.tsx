import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { OptionResult } from "@/features/resolution/utils/sessionResults";
import type { SessionOption } from "@/features/sessions/types";

import { addresses } from "@/testing/fixtures";

import { OptionCard } from "../OptionCard";

const option: SessionOption = {
  market: addresses.childMarkets[0],
  outcomeIndex: 1,
  name: "Greta Gerwig",
  color: "#009aff",
  question: "Opening weekend gross if Gerwig directs",
  unit: "$M",
  lowerBound: 0,
  upperBound: 500,
  upToken: addresses.upToken,
  invalidToken: addresses.childInvalidToken,
  downToken: addresses.downToken,
  underlyingToken: addresses.underlyingToken,
  blocks: [],
};

function renderCard(result: OptionResult, pnl?: bigint) {
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
  const toggle = screen.getByRole("heading", { level: 3, name: option.name }).closest("button[aria-expanded]")!;
  return { card: toggle.parentElement as HTMLElement, toggle: toggle as HTMLElement };
}

describe("OptionCard on a resolved session", () => {
  it("shows a winner's answer in its title row and marks it on the slider", () => {
    const { card, toggle } = renderCard({ kind: "final", text: "312.5 $M", share: 0.625 });

    expect(toggle).toHaveTextContent("Result 312.5 $M");
    expect(within(card).getByTestId("final-value-marker").style.left).toBe("62.5%");
    expect(card.className).not.toMatch(/opacity/);
  });

  it("mutes a losing option's name with the theme's secondary text, its P&L kept at full tone (F3, F6, F29)", () => {
    const { card, toggle } = renderCard({ kind: "not-selected" }, -5n * 10n ** 18n);

    expect(toggle).toHaveTextContent("Not selected");
    for (let at: HTMLElement | null = toggle; at; at = at.parentElement) expect(at.className).not.toMatch(/opacity/);
    expect(within(toggle).getByText(option.name).closest("h3")).toHaveClass("text-fs-text-secondary");
    expect(within(toggle).getByText("-5.00 sDAI")).toHaveClass("text-fs-tone-error-text");
    expect(within(card).queryByTestId("final-value-marker")).toBeNull();
  });

  it("reads every option of a session resolved INVALID as Invalid, not dimmed, the header carrying the payouts (D19)", () => {
    const { card, toggle } = renderCard({ kind: "invalid" });

    expect(toggle).toHaveTextContent("Invalid");
    expect(toggle).not.toHaveTextContent("Not selected");
    expect(card).not.toHaveTextContent("Pays per token");
    expect(card.className).not.toMatch(/opacity/);
    expect(within(toggle).getByText(option.name).closest("h3")).toHaveClass("text-fs-text-primary");
  });

  it("reads an INVALID child as Invalid, with what each of its tokens pays", () => {
    const { card, toggle } = renderCard({ kind: "invalid", payouts: "Pays per token: UP 0, DOWN 0, INVALID 1" });

    expect(toggle).toHaveTextContent("Invalid");
    expect(card).toHaveTextContent("Pays per token: UP 0, DOWN 0, INVALID 1");
    expect(within(card).queryByTestId("final-value-marker")).toBeNull();
  });
});
