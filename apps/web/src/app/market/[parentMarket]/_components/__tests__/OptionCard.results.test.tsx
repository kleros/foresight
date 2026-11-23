import { render, screen } from "@testing-library/react";
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
const HALF = 5n * 10n ** 17n;

function renderCard(result: OptionResult | undefined) {
  return render(
    <OptionCard
      option={option}
      parentMarket={addresses.parentMarket}
      status="resolved"
      marketEstimate={250}
      isMarketPending={false}
      collateralSymbol="sDAI"
      result={result}
    />,
  );
}

const toggle = () => screen.getByRole("heading", { level: 3, name: option.name }).closest("button")!;
const cardRoot = () => screen.getByRole("heading", { level: 3, name: option.name }).closest("button")!.parentElement!;

describe("OptionCard on a resolved session", () => {
  it("dims a losing option and no other", () => {
    const { unmount } = renderCard({ kind: "not-selected" });
    expect(cardRoot()).toHaveClass("opacity-60");
    unmount();

    const others: OptionResult[] = [
      { kind: "waiting" },
      { kind: "final", value: 125, text: "125 $M" },
      { kind: "invalid", payouts: [{ token: "INVALID", pays: HALF }] },
    ];
    for (const result of others) {
      const { unmount: next } = renderCard(result);
      expect(cardRoot(), result.kind).not.toHaveClass("opacity-60");
      next();
    }
  });

  it("labels an INVALID option in its collapsed title row", () => {
    renderCard({ kind: "invalid", payouts: [{ token: "INVALID", pays: HALF }] });

    expect(toggle()).toHaveTextContent("Invalid");
  });

  it.each([
    { at: "the lower bound", value: 100, percent: 0 },
    { at: "a value inside", value: 200, percent: 25 },
    { at: "the upper bound", value: 500, percent: 100 },
  ])("on a scale that starts above zero, marks a final value at $at $percent percent along", ({ value, percent }) => {
    render(
      <OptionCard
        option={{ ...option, lowerBound: 100, upperBound: 500 }}
        parentMarket={addresses.parentMarket}
        status="resolved"
        marketEstimate={250}
        isMarketPending={false}
        result={{ kind: "final", value, text: `${value} $M` }}
      />,
    );

    expect(parseFloat(screen.getByTestId("final-value-marker").style.left)).toBeCloseTo(percent, 5);
  });

  it("states what each token of an INVALID child pays", () => {
    renderCard({
      kind: "invalid",
      payouts: [
        { token: "DOWN", pays: 0n },
        { token: "UP", pays: 0n },
        { token: "INVALID", pays: HALF },
      ],
    });

    expect(cardRoot()).toHaveTextContent("Invalid: DOWN pays 0 sDAI, UP pays 0 sDAI, INVALID pays 0.5 sDAI.");
  });

  it("states what the option's token pays under an INVALID parent", () => {
    renderCard({ kind: "invalid", payouts: [{ token: "this option's token", pays: 0n }] });

    expect(cardRoot()).toHaveTextContent("Invalid: this option's token pays 0 sDAI.");
  });

  it("claims no result while the option's child is still being read", () => {
    renderCard({ kind: "pending" });

    expect(cardRoot()).not.toHaveTextContent(/Could not read|Waiting for result|Not selected|Invalid|Final/);
  });

  it("says a failed child read is being retried", () => {
    renderCard({ kind: "unread" });

    expect(cardRoot()).toHaveTextContent("Could not read this option's result. Retrying.");
  });
});
