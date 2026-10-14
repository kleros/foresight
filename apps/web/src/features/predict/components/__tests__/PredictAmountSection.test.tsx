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

describe("Max and 50% on a wallet of 1.234567890123456789 xDAI", () => {
  it("Max fills 1.2245 xDAI: 0.01 kept for gas, the rest cut to 4 decimals", async () => {
    const onAmountChange = renderSection(xDai, 1_234_567_890_123_456_789n);

    await userEvent.click(screen.getByRole("button", { name: "Max" }));

    expect(lastAmount(onAmountChange)).toBe(1_224_500_000_000_000_000n);
  });

  it("50% fills 0.6122 xDAI, half of 1.2245 cut to 4 decimals", () => {
    const onAmountChange = renderSection(xDai, 1_234_567_890_123_456_789n);

    fireEvent.change(screen.getByRole("slider"), { target: { value: "50" } });

    expect(lastAmount(onAmountChange)).toBe(612_200_000_000_000_000n);
  });
});

describe("75% on a wallet of 1.234567890123456789 xDAI", () => {
  it("fills 0.9183 xDAI, three quarters of what Max fills cut to 4 decimals", () => {
    const onAmountChange = renderSection(xDai, 1_234_567_890_123_456_789n);

    fireEvent.change(screen.getByRole("slider"), { target: { value: "75" } });

    expect(lastAmount(onAmountChange)).toBe(918_300_000_000_000_000n);
  });
});

describe("Max and 50% on a wallet of 1.234567 of a 6-decimal token", () => {
  const usdc: PayTokenChoice = { id: "collateral", symbol: "USDC", decimals: 6 };

  it("Max fills 1.2345, cut to 4 of the token's 6 decimals", async () => {
    const onAmountChange = renderSection(usdc, 1_234_567n);

    await userEvent.click(screen.getByRole("button", { name: "Max" }));

    expect(lastAmount(onAmountChange)).toBe(1_234_500n);
  });

  it("50% fills 0.6172, half of 1.2345 cut to 4 decimals", () => {
    const onAmountChange = renderSection(usdc, 1_234_567n);

    fireEvent.change(screen.getByRole("slider"), { target: { value: "50" } });

    expect(lastAmount(onAmountChange)).toBe(617_200n);
  });
});

describe("the amount field", () => {
  it("is named Amount for assistive tech", () => {
    renderSection(sDai, 10n ** 18n);

    expect(screen.getByLabelText("Amount")).toBeInTheDocument();
  });
});

describe("the total line", () => {
  it("names a part too small to show rather than saying 0", () => {
    const funding = planFunding({ amount: 4n * WAD + 1n, ownWallet: 10n * WAD, tradeWallet: 4n * WAD });
    render(
      <PredictAmountSection
        amount={4n * WAD + 1n}
        onAmountChange={vi.fn()}
        tokens={[sDai]}
        token={sDai}
        onTokenChange={vi.fn()}
        funding={funding}
        collateral={{ symbol: "sDAI", decimals: 18 }}
        isFirstPrediction={false}
        isReadOnly={false}
      />,
    );

    expect(screen.getByText(/in your trade wallet/)).toHaveTextContent(
      `4 sDAI = 4 in your trade wallet + less than ${1 / 10 ** AMOUNT_DISPLAY_DECIMALS} from your wallet`,
    );
  });
});

describe("a locked amount", () => {
  // jsdom computes no Tailwind, so the dimmed look is read from the class on each control's root
  it.each([true, false])("dims the field and the slider only when locked (%s)", (isReadOnly) => {
    render(
      <PredictAmountSection
        amount={WAD}
        onAmountChange={vi.fn()}
        tokens={[sDai]}
        token={sDai}
        onTokenChange={vi.fn()}
        funding={planFunding({ amount: WAD, ownWallet: 10n * WAD, tradeWallet: 0n })}
        collateral={{ symbol: "sDAI", decimals: 18 }}
        isFirstPrediction
        isReadOnly={isReadOnly}
      />,
    );

    for (const id of ["amount-input", "amount-slider"])
      expect(screen.getByTestId(id).classList.contains("opacity-50")).toBe(isReadOnly);
  });
});

describe("an empty balance", () => {
  it("dims the share slider, which has nothing to share out", () => {
    renderSection(sDai, 0n);

    expect(screen.getByTestId("amount-slider").classList.contains("opacity-50")).toBe(true);
  });
});
