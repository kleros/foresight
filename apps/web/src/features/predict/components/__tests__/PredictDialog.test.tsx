import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { OptionScale } from "@/types/optionScale";

import type { SelectedEstimate } from "../../types";
import type { Funding } from "../../utils/funding";
import type { PredictSteps } from "../../utils/predictSteps";
import { PredictDialog } from "../PredictDialog";

const scale = (market: string, name: string): OptionScale => ({
  market: market as `0x${string}`,
  name,
  color: "#009aff",
  unit: "$M",
  lowerBound: 0,
  upperBound: 500,
});

const GERWIG = "0xcccccccccccccccccccccccccccccccccccccccc";
const COOGLER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const WAD = 10n ** 18n;

const selected: SelectedEstimate[] = [
  { scale: scale(GERWIG, "Greta Gerwig"), value: 400, marketEstimate: 312, direction: "higher" },
  { scale: scale(COOGLER, "Ryan Coogler"), value: 200, marketEstimate: 296, direction: "lower" },
];

const sDai = { id: "collateral" as const, symbol: "sDAI", decimals: 18 };

const funding = (overrides: Partial<Funding> = {}): Funding => ({
  available: 25n * WAD,
  collateralIn: 10n * WAD,
  tradeWallet: 6n * WAD,
  fromTradeWallet: 6n * WAD,
  toAdd: 4n * WAD,
  deposit: 4n * WAD,
  ...overrides,
});

const steps: PredictSteps = {
  rows: [
    { key: "wallet", title: "Create a trade wallet", subtitle: "", view: "idle" },
    { key: "funds", title: "Add funds to your trade wallet", subtitle: "Adding 4 sDAI", view: "idle" },
    { key: "predict", title: "Make prediction", subtitle: "", view: "idle" },
  ],
};

const props = () => ({
  isOpen: true,
  onClose: vi.fn(),
  selected,
  onRemove: vi.fn(),
  amount: (10n * WAD) as bigint | undefined,
  onAmountChange: vi.fn(),
  tokens: [sDai],
  token: sDai,
  onTokenChange: vi.fn(),
  funding: funding() as Funding | null,
  collateral: { symbol: "sDAI", decimals: 18 },
  isFirstPrediction: true,
  steps,
  skipped: 0,
  isRunning: false,
  onPredict: vi.fn(),
});

describe("the estimates going in", () => {
  it("lists each estimate with which way it moves the market", () => {
    render(<PredictDialog {...props()} />);

    expect(screen.getByText("Greta Gerwig")).toBeInTheDocument();
    expect(screen.getByText("400 $M")).toBeInTheDocument();
    expect(screen.getByText(/Higher than the market/)).toBeInTheDocument();
    expect(screen.getByText(/Lower than the market/)).toBeInTheDocument();
  });

  it("drops an estimate the visitor takes out here", async () => {
    const onRemove = vi.fn();
    render(<PredictDialog {...props()} onRemove={onRemove} />);

    await userEvent.click(screen.getByRole("button", { name: "Remove Greta Gerwig" }));

    expect(onRemove).toHaveBeenCalledWith(GERWIG);
  });

  it("keeps the last estimate in", () => {
    render(<PredictDialog {...props()} selected={selected.slice(0, 1)} />);

    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
  });
});

describe("the amount behind them", () => {
  it("counts the trade wallet into the balance", () => {
    render(<PredictDialog {...props()} />);

    expect(screen.getByText("Balance: 25 sDAI")).toBeInTheDocument();
  });

  it("says where the total comes from", () => {
    render(<PredictDialog {...props()} />);

    expect(screen.getByText("Total: 10 sDAI =")).toBeInTheDocument();
    expect(screen.getByText(/6 \(sDAI in Trade\s+Wallet\)/)).toBeInTheDocument();
    expect(screen.getByText(/4 \(Your Wallet\)/)).toBeInTheDocument();
  });

  it("fills the whole balance on Max", async () => {
    const onAmountChange = vi.fn();
    render(<PredictDialog {...props()} onAmountChange={onAmountChange} />);

    await userEvent.click(screen.getByRole("button", { name: "Max" }));

    expect(onAmountChange).toHaveBeenCalledWith(25n * WAD);
  });

  it("refuses an amount larger than the balance", () => {
    render(<PredictDialog {...props()} amount={26n * WAD} />);

    expect(screen.getByText("Not enough balance.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Predict" })).toBeDisabled();
  });

  it("does not call a balance it has not read yet zero", () => {
    render(<PredictDialog {...props()} funding={null} />);

    expect(screen.getByText("Checking your balance…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Predict" })).toBeDisabled();
  });

  it("asks for extra funds, with a note, once the visitor has predicted before", () => {
    render(<PredictDialog {...props()} isFirstPrediction={false} />);

    expect(screen.getByText("Extra funds")).toBeInTheDocument();
    expect(screen.getByText(/change it even without adding extra funds/)).toBeInTheDocument();
  });

  it("will not predict with nothing behind a first prediction", () => {
    render(<PredictDialog {...props()} amount={undefined} funding={funding({ collateralIn: 0n })} />);

    expect(screen.getByRole("button", { name: "Predict" })).toBeDisabled();
  });

  it("lets a returning visitor move their prediction without adding anything", async () => {
    const onPredict = vi.fn();
    render(
      <PredictDialog
        {...props()}
        isFirstPrediction={false}
        amount={undefined}
        funding={funding({ collateralIn: 0n })}
        onPredict={onPredict}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Predict" }));

    expect(onPredict).toHaveBeenCalled();
  });
});

describe("predicting", () => {
  it("shows the steps before anything is signed", () => {
    render(<PredictDialog {...props()} />);

    expect(screen.getByText("Create a trade wallet")).toBeInTheDocument();
    expect(screen.getByText("Adding 4 sDAI")).toBeInTheDocument();
    expect(screen.getByText("Make prediction")).toBeInTheDocument();
  });

  it("starts the run on Predict", async () => {
    const onPredict = vi.fn();
    render(<PredictDialog {...props()} onPredict={onPredict} />);

    await userEvent.click(screen.getByRole("button", { name: "Predict" }));

    expect(onPredict).toHaveBeenCalled();
  });

  it("asks for what is missing before it can predict", () => {
    render(<PredictDialog {...props()} notice="Switch to Gnosis to make this prediction." />);

    expect(screen.getByText("Switch to Gnosis to make this prediction.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Predict" })).toBeDisabled();
  });

  it("offers no way out part way through, which would abandon work already on chain", () => {
    render(<PredictDialog {...props()} isRunning />);

    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    for (const remove of screen.getAllByRole("button", { name: /Remove/ })) expect(remove).toBeDisabled();
  });

  it("says why a run stopped, and lets Predict pick it up again", async () => {
    const onPredict = vi.fn();
    render(
      <PredictDialog
        {...props()}
        steps={{ ...steps, failure: "You turned the request down." }}
        onPredict={onPredict}
      />,
    );

    expect(screen.getByText("Prediction failed!")).toBeInTheDocument();
    expect(screen.getByText("You turned the request down.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Predict" }));
    expect(onPredict).toHaveBeenCalled();
  });

  it("says which estimates were left out", () => {
    render(<PredictDialog {...props()} skipped={1} />);

    expect(screen.getByText(/1 of your estimates could not be traded/)).toBeInTheDocument();
  });
});
