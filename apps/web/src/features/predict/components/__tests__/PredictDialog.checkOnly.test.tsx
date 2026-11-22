import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { SelectedEstimate } from "../../types";
import type { PredictSteps } from "../../utils/predictSteps";
import type { SlippageSettings } from "../../utils/slippage";
import { PredictDialog } from "../PredictDialog";

const WAD = 10n ** 18n;
const sDai = { id: "collateral" as const, symbol: "sDAI", decimals: 18 };

const selected: SelectedEstimate[] = [
  {
    scale: {
      market: "0xcccccccccccccccccccccccccccccccccccccccc",
      name: "Greta Gerwig",
      color: "#009aff",
      unit: "$M",
      lowerBound: 0,
      upperBound: 500,
    },
    value: 400,
    marketEstimate: 312,
    direction: "higher",
  },
];

const steps: PredictSteps = {
  rows: [{ key: "predict", title: "Place prediction", subtitle: "", view: "idle" }],
};

const RECOVERED = {
  deposit: WAD,
  funding: { collateralIn: WAD, creditsIn: 0n, fromTradeWallet: 0n },
  depositSettled: false,
  firstBatchSettled: false,
  token: sDai,
  slippage: { tradeBps: 50 },
};

const NOTICE = "Couldn't check whether this session has resolved. Trying again.";

function renderDialog(extra: Partial<Parameters<typeof PredictDialog>[0]>) {
  const onPredict = vi.fn();
  render(
    <PredictDialog
      isOpen
      onClose={vi.fn()}
      selected={selected}
      onRemove={vi.fn()}
      amount={WAD}
      onAmountChange={vi.fn()}
      tokens={[sDai]}
      token={sDai}
      onTokenChange={vi.fn()}
      funding={null}
      collateral={{ symbol: "sDAI", decimals: 18 }}
      optionNoun="director"
      isFirstPrediction={false}
      steps={steps}
      leftOut={0}
      isRunning={false}
      canRetry
      slippage={{ settings: { tradeBps: null, creditsBps: null } as SlippageSettings, onChange: vi.fn() }}
      pricesReady={false}
      notice={NOTICE}
      onPredict={onPredict}
      {...extra}
    />,
  );
  return onPredict;
}

describe("PredictDialog with a press that only checks the chain", () => {
  it.each([
    ["a held send it would otherwise sign again", { asksToSignAgain: true, isPending: true }],
    ["a stored run it would otherwise resume, its credits price unread", { recovered: RECOVERED, isPending: true }],
    ["a stopped run it would otherwise try again", {}],
  ])("offers Check again through the notice, for %s", async (_name, extra) => {
    const onPredict = renderDialog({ ...extra, isCheckOnly: true });

    expect(screen.getByText(NOTICE)).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Check again" });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(onPredict).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Sign again" })).toBeNull();
  });

  it("keeps the button off through the notice when the press would do more than check", () => {
    renderDialog({ asksToSignAgain: true, isPending: true });

    expect(screen.getByRole("button", { name: "Sign again" })).toBeDisabled();
  });
});
