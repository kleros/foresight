import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { OptionScale } from "@/types/optionScale";

import type { SelectedEstimate } from "../../types";
import type { Funding } from "../../utils/funding";
import { predictSteps, type PredictSteps } from "../../utils/predictSteps";
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
  canRetry: false,
  onPredict: vi.fn(),
});

describe("the estimates going in", () => {
  it("says where each market would move", () => {
    render(<PredictDialog {...props()} preview={{ [GERWIG.toLowerCase()]: { from: 312, to: 355 } }} />);

    expect(screen.getByText("Market moves from 312 $M to 355 $M")).toBeInTheDocument();
    expect(screen.getAllByText(/Market moves/)).toHaveLength(1);
  });

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

    expect(screen.getByText("Total: 10 sDAI")).toBeInTheDocument();
    expect(screen.getByText("(6 from your trade wallet + 4 from your wallet)")).toBeInTheDocument();
  });

  it("names only the source the total comes from", () => {
    render(
      <PredictDialog {...props()} funding={funding({ tradeWallet: 0n, fromTradeWallet: 0n, toAdd: 10n * WAD })} />,
    );

    expect(screen.getByText("(10 from your wallet)")).toBeInTheDocument();
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

  it("offers the rest of a stopped run on the amount and estimates it started with", async () => {
    const onPredict = vi.fn();
    render(
      <PredictDialog
        {...props()}
        amount={100n * WAD}
        canRetry
        steps={{
          ...steps,
          failure: "1 of 2 predictions went through. The trade could not go through at these prices.",
        }}
        onPredict={onPredict}
      />,
    );

    expect(screen.queryByRole("button", { name: "Predict" })).not.toBeInTheDocument();
    for (const remove of screen.getAllByRole("button", { name: /Remove/ })) expect(remove).toBeDisabled();
    expect(screen.getByRole("button", { name: "Max" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Try the rest" }));
    expect(onPredict).toHaveBeenCalled();
  });

  it("does not offer the rest while the wallet is on the wrong network", () => {
    render(<PredictDialog {...props()} canRetry notice="Switch to Gnosis to make this prediction." />);

    expect(screen.getByRole("button", { name: "Try the rest" })).toBeDisabled();
  });

  it("shows a stored run's own deposit in place of the amount form, and offers only Resume", async () => {
    const onPredict = vi.fn();
    render(
      <PredictDialog
        {...props()}
        selected={[{ scale: scale(GERWIG, "Greta Gerwig"), value: 410 }]}
        recovered={{ deposit: 7_250_000_000_000_000_001n, symbol: "sDAI", decimals: 18 }}
        canRetry
        onPredict={onPredict}
      />,
    );

    expect(screen.getByText("Deposit: 7.250000000000000001 sDAI")).toBeInTheDocument();
    expect(screen.getByText("410 $M")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Max" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Predict" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(onPredict).toHaveBeenCalled();
  });

  it("will not resume a stored run that cannot be picked up", () => {
    render(<PredictDialog {...props()} recovered={{ deposit: WAD, symbol: "sDAI", decimals: 18 }} canRetry={false} />);

    expect(screen.getByRole("button", { name: "Resume" })).toBeDisabled();
  });

  it("says which estimates were left out", () => {
    render(<PredictDialog {...props()} skipped={1} />);

    expect(screen.getByText(/1 of your estimates could not be traded/)).toBeInTheDocument();
  });
});

describe("a second prediction the trade wallet already covers", () => {
  const nothingToAdd = (symbol: string) =>
    predictSteps({
      wallet: { address: "0xdcee0000000000000000000000000000000c664f", deployed: true },
      toAdd: 0n,
      symbol,
      decimals: 18,
      progress: null,
    });

  it.each(["sDAI", "xDAI"])("shows no 'Adding 0 %s' step", (symbol) => {
    render(
      <PredictDialog
        {...props()}
        isFirstPrediction={false}
        amount={undefined}
        funding={funding({ collateralIn: 0n, fromTradeWallet: 0n, toAdd: 0n, deposit: 0n })}
        steps={nothingToAdd(symbol)}
      />,
    );

    expect(screen.queryByText(new RegExp(`Adding 0 ${symbol}`))).toBeNull();
    expect(screen.queryByText(/Adding 0\b/)).toBeNull();
  });
});

describe("the dialog's accessible name", () => {
  it("says it is the prediction, not the library's default", () => {
    render(<PredictDialog {...props()} />);

    expect(screen.getByRole("dialog", { name: /predict/i })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Modal" })).toBeNull();
  });
});

describe("what the estimate caps", () => {
  // Product policy: the estimate bounds where the market ends, and the average fill includes the pool fee.
  const endsAtEstimate = /\b(ends?|stops?|settles?|lands?|finish(es)?)\b[^.]*\bat (your|the|each) estimates?\b/i;
  const averageIncludesFee = /\baverage\b[^.]*\b(includes?|including)\b[^.]*\bpool fees?\b/i;

  const dialogText = () => screen.getByRole("dialog").textContent?.replace(/\s+/g, " ") ?? "";

  it.each([
    ["an estimate above the market", selected.slice(0, 1)],
    ["an estimate below the market", selected.slice(1)],
    ["estimates both ways at once", selected],
  ])("says the market ends at the estimate and the average includes the pool fee, for %s", (_, estimates) => {
    render(<PredictDialog {...props()} selected={estimates} />);

    expect(dialogText()).toMatch(endsAtEstimate);
    expect(dialogText()).toMatch(averageIncludesFee);
  });

  it("says it to a returning visitor moving an existing prediction", () => {
    render(
      <PredictDialog
        {...props()}
        isFirstPrediction={false}
        amount={undefined}
        funding={funding({ collateralIn: 0n })}
      />,
    );

    expect(dialogText()).toMatch(endsAtEstimate);
    expect(dialogText()).toMatch(averageIncludesFee);
  });
});
