import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { CreditsHeld } from "@/lib/trade-executor/credits";

import { creditLines, creditsOffer } from "../../utils/credits";
import { planFunding } from "../../utils/funding";
import { PredictAmountSection, type PayTokenChoice } from "../PredictAmountSection";

const WAD = 10n ** 18n;
const sDai: PayTokenChoice = { id: "collateral", symbol: "sDAI", decimals: 18 };

/** The amount panel for a visitor with 19 sDAI of their own and `held` credits. */
function renderLine(held: CreditsHeld, options: { isUsing?: boolean; isReadOnly?: boolean; amount?: bigint } = {}) {
  const { isUsing = true, isReadOnly = false, amount } = options;
  const offer = creditsOffer(held);
  const funding = planFunding({
    amount: amount ?? 0n,
    ownWallet: 19n * WAD,
    tradeWallet: 0n,
    credits: isUsing ? creditLines(held, offer) : [],
  });
  const onAmountChange = vi.fn();
  const onUsingChange = vi.fn();
  render(
    <PredictAmountSection
      amount={amount}
      onAmountChange={onAmountChange}
      tokens={[sDai]}
      token={sDai}
      onTokenChange={vi.fn()}
      funding={funding}
      collateral={{ symbol: "sDAI", decimals: 18 }}
      isFirstPrediction
      isReadOnly={isReadOnly}
      credits={offer.state === "none" ? undefined : { offer, isUsing, onUsingChange }}
    />,
  );
  return { onAmountChange, onUsingChange };
}

const tick = () => screen.getByRole("checkbox", { name: "Use your Foresight credits" });
const useMax = () => screen.getByRole("button", { name: "Use max", hidden: true });
const note = () => screen.getByTestId("credits-note");

describe("the credits line", () => {
  it("is absent for a visitor with no credits worth offering", () => {
    renderLine({ wallet: WAD / 200n, tradeWallet: 0n, manager: 1000n * WAD });

    expect(screen.queryByTestId("credits-line")).toBeNull();
  });

  it("is ticked with Use max when the manager covers every credit, and says how many", () => {
    const { onAmountChange } = renderLine({ wallet: 3n * WAD, tradeWallet: 2n * WAD, manager: 1000n * WAD });

    expect(tick()).toBeChecked();
    expect(tick()).toBeEnabled();
    expect(note()).toHaveTextContent("5 credits available");
    expect(useMax()).toBeEnabled();

    fireEvent.click(useMax());
    expect(onAmountChange).toHaveBeenLastCalledWith(5n * WAD);
  });

  it("keeps the balance to the visitor's money while Max counts the credits too", () => {
    const { onAmountChange } = renderLine({ wallet: 5n * WAD, tradeWallet: 0n, manager: 1000n * WAD });

    expect(screen.getByTestId("balance-figure")).toHaveTextContent("19 sDAI");
    fireEvent.click(screen.getByRole("button", { name: "Max" }));
    expect(onAmountChange).toHaveBeenLastCalledWith(24n * WAD);
  });

  it("names the credits part of a typed amount", () => {
    renderLine({ wallet: 2n * WAD, tradeWallet: 0n, manager: 1000n * WAD }, { amount: 5n * WAD });

    expect(screen.getByText("≈ 5 sDAI = 2 in credits + 3 from your wallet")).toBeInTheDocument();
  });

  it("unticked, hides Use max but keeps its room, and still says what is available", () => {
    const { onUsingChange } = renderLine(
      { wallet: 5n * WAD, tradeWallet: 0n, manager: 1000n * WAD },
      { isUsing: false },
    );

    expect(tick()).not.toBeChecked();
    expect(useMax()).toBeDisabled();
    expect(useMax().className).toContain("invisible");
    expect(note()).toHaveTextContent("5 credits available");

    fireEvent.click(tick());
    expect(onUsingChange).toHaveBeenLastCalledWith(true);
  });

  it("when the manager is short, says how many are usable right now and Use max takes only those", () => {
    const { onAmountChange } = renderLine({ wallet: 500n * WAD, tradeWallet: 0n, manager: 200n * WAD });

    expect(tick()).toBeChecked();
    expect(note()).toHaveTextContent("200 of your 500 credits usable right now");

    fireEvent.click(useMax());
    expect(onAmountChange).toHaveBeenLastCalledWith(200n * WAD);
  });

  it("when the manager is empty, cannot be ticked and asks for the visitor's own collateral", () => {
    renderLine({ wallet: 5n * WAD, tradeWallet: 0n, manager: 0n });

    expect(tick()).not.toBeChecked();
    expect(tick()).toBeDisabled();
    expect(useMax()).toBeDisabled();
    expect(note()).toHaveTextContent("None usable right now. Add your own sDAI.");
  });

  it("is locked with the rest of the form while a run holds it", () => {
    renderLine({ wallet: 5n * WAD, tradeWallet: 0n, manager: 1000n * WAD }, { isReadOnly: true });

    expect(tick()).toBeDisabled();
    expect(useMax()).toBeDisabled();
  });
});
