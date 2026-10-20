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

const tick = () => screen.getByRole("checkbox", { name: "Use Foresight credits" });
const useMax = () => screen.getByRole("button", { name: "Max credits", hidden: true });
const note = () => screen.getByTestId("credits-note");

describe("the credits line", () => {
  it("is absent for a visitor with no credits worth offering", () => {
    renderLine({ wallet: WAD / 200n, tradeWallet: 0n, manager: 1000n * WAD });

    expect(screen.queryByTestId("credits-line")).toBeNull();
  });

  it("is ticked with Max credits when the manager covers every credit, and says how many", () => {
    const { onAmountChange } = renderLine({ wallet: 3n * WAD, tradeWallet: 2n * WAD, manager: 1000n * WAD });

    expect(tick()).toBeChecked();
    expect(tick()).toBeEnabled();
    expect(note()).toHaveTextContent("5 credits available");
    expect(useMax()).toBeEnabled();

    fireEvent.click(useMax());
    expect(onAmountChange).toHaveBeenLastCalledWith(5n * WAD);
  });

  it("keeps the balance, Max and the slider's share to the visitor's money while the credits are ticked", () => {
    const { onAmountChange } = renderLine(
      { wallet: 5n * WAD, tradeWallet: 0n, manager: 1000n * WAD },
      { amount: 19n * WAD },
    );

    expect(screen.getByTestId("balance-figure")).toHaveTextContent("19 sDAI");
    expect(screen.getByTestId("amount-share")).toHaveTextContent("100%");
    fireEvent.click(screen.getByRole("button", { name: "Max" }));
    expect(onAmountChange).toHaveBeenLastCalledWith(19n * WAD);
  });

  it("names the credits part of a typed amount", () => {
    renderLine({ wallet: 2n * WAD, tradeWallet: 0n, manager: 1000n * WAD }, { amount: 5n * WAD });

    expect(screen.getByText("≈ 5 sDAI = 2 in credits + 3 from your wallet")).toBeInTheDocument();
  });

  it("unticked, hides Max credits but keeps its room, and still says what is available", () => {
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

  it("when the manager is short, says how many are usable now and Max credits takes only those", () => {
    const { onAmountChange } = renderLine({ wallet: 50n * WAD, tradeWallet: 0n, manager: 20n * WAD });

    expect(tick()).toBeChecked();
    expect(note()).toHaveTextContent("20 of 50 usable now");

    fireEvent.click(useMax());
    expect(onAmountChange).toHaveBeenLastCalledWith(20n * WAD);
  });

  it("when the manager is empty, offers no tick, says none of them is usable and asks for the visitor's own money", () => {
    renderLine({ wallet: 5n * WAD, tradeWallet: 0n, manager: 0n });

    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(useMax()).toBeDisabled();
    expect(screen.getByText("Foresight credits")).toBeInTheDocument();
    expect(note().textContent).toBe("0 of 5 usable. Pay from your wallet.");
  });

  it("is locked with the rest of the form while a run holds it", () => {
    renderLine({ wallet: 5n * WAD, tradeWallet: 0n, manager: 1000n * WAD }, { isReadOnly: true });

    expect(tick()).toBeDisabled();
    expect(useMax()).toBeDisabled();
  });
});
