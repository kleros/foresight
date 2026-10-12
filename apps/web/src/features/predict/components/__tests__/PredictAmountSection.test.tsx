import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AMOUNT_DISPLAY_DECIMALS, GAS_RESERVE_WEI } from "../../oracle/tolerances";
import { planFunding } from "../../utils/funding";
import { PredictAmountSection, type PayTokenChoice } from "../PredictAmountSection";

const WAD = 10n ** 18n;
const STEP = 10n ** BigInt(18 - AMOUNT_DISPLAY_DECIMALS);

const sDai: PayTokenChoice = { id: "collateral", symbol: "sDAI", decimals: 18 };
const xDai: PayTokenChoice = { id: "native", symbol: "xDAI", decimals: 18 };

// 1.25 xDAI per sDAI
const RATE = (5n * WAD) / 4n;

/** A wallet holding only `held` of the pay token, with an empty trade wallet. */
function renderSection(token: PayTokenChoice, held: bigint) {
  const funding = planFunding({
    amount: 0n,
    ownWallet: held,
    tradeWallet: 0n,
    tokenPerCollateralWad: token.id === "native" ? RATE : undefined,
  });
  const onAmountChange = vi.fn();
  render(
    <PredictAmountSection
      amount={undefined}
      onAmountChange={onAmountChange}
      tokens={[sDai, xDai]}
      token={token}
      onTokenChange={vi.fn()}
      funding={funding}
      collateral={{ symbol: "sDAI", decimals: 18 }}
      isFirstPrediction
      isReadOnly={false}
    />,
  );
  return onAmountChange;
}

function lastAmount(onAmountChange: ReturnType<typeof vi.fn>): bigint {
  const call = onAmountChange.mock.calls.at(-1);
  expect(call).toBeDefined();
  return call![0] as bigint;
}

const decimalsOf = (amount: bigint) => amount.toString().padStart(19, "0").slice(-18).replace(/0+$/, "").length;

// balances with more decimals than the field shows
const wallets = [
  { name: "sDAI", token: sDai, held: 7_777_777_777_777_777_777n, spendable: 7_777_777_777_777_777_777n },
  {
    name: "xDAI",
    token: xDai,
    held: 1_234_567_890_123_456_789n,
    spendable: 1_234_567_890_123_456_789n - GAS_RESERVE_WEI,
  },
  {
    name: "xDAI, under one",
    token: xDai,
    held: 345_678_901_234_567_891n,
    spendable: 345_678_901_234_567_891n - GAS_RESERVE_WEI,
  },
];

describe.each(wallets)("Max and 50% with only $name in the wallet", ({ token, held, spendable }) => {
  it(`Max fills at most ${AMOUNT_DISPLAY_DECIMALS} decimals, rounded down from what can be spent`, async () => {
    const onAmountChange = renderSection(token, held);

    await userEvent.click(screen.getByRole("button", { name: "Max" }));

    const amount = lastAmount(onAmountChange);
    expect(decimalsOf(amount)).toBeLessThanOrEqual(AMOUNT_DISPLAY_DECIMALS);
    expect(amount).toBeLessThanOrEqual(spendable);
    expect(spendable - amount).toBeLessThan(STEP);
  });

  it(`50% fills at most ${AMOUNT_DISPLAY_DECIMALS} decimals, rounded down from half of what can be spent`, () => {
    const onAmountChange = renderSection(token, held);

    fireEvent.change(screen.getByRole("slider"), { target: { value: "50" } });

    const amount = lastAmount(onAmountChange);
    const half = spendable / 2n;
    expect(decimalsOf(amount)).toBeLessThanOrEqual(AMOUNT_DISPLAY_DECIMALS);
    expect(amount).toBeLessThanOrEqual(half);
    expect(half - amount).toBeLessThan(2n * STEP);
  });
});

describe("Max on an xDAI wallet holding no more than the gas reserve", () => {
  it("never offers any of the reserve", async () => {
    const onAmountChange = renderSection(xDai, GAS_RESERVE_WEI / 2n);

    const max = screen.getByRole("button", { name: "Max" });
    if (!max.hasAttribute("disabled")) await userEvent.click(max);

    for (const [amount] of onAmountChange.mock.calls) expect(amount ?? 0n).toBe(0n);
  });
});
