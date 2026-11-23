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

function renderCard(result: OptionResult) {
  render(
    <OptionCard
      option={option}
      parentMarket={addresses.parentMarket}
      status="resolved"
      marketEstimate={250}
      isMarketPending={false}
      result={result}
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

  it("dims a losing option and says it was not selected", () => {
    const { card, toggle } = renderCard({ kind: "not-selected" });

    expect(toggle).toHaveTextContent("Not selected");
    expect(card.className).toMatch(/opacity-60/);
    expect(within(card).queryByTestId("final-value-marker")).toBeNull();
  });

  it("reads an INVALID child as Invalid, with what each of its tokens pays", () => {
    const { card, toggle } = renderCard({ kind: "invalid", payouts: "Pays per token: UP 0, DOWN 0, INVALID 1" });

    expect(toggle).toHaveTextContent("Invalid");
    expect(card).toHaveTextContent("Pays per token: UP 0, DOWN 0, INVALID 1");
    expect(within(card).queryByTestId("final-value-marker")).toBeNull();
  });
});
