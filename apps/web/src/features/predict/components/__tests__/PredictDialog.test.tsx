import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { OptionScale } from "@/types/optionScale";

import type { SelectedEstimate } from "../../types";
import { planFunding, type Funding } from "../../utils/funding";
import { fundsToAdd, predictSteps, type PredictSteps } from "../../utils/predictSteps";
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
    { key: "funds", title: "Add funds", subtitle: "4 sDAI", view: "idle" },
    { key: "predict", title: "Place prediction", subtitle: "", view: "idle" },
  ],
};

const subtitleOf = (title: string) =>
  screen.getByRole("listitem", { name: `Timeline item: ${title}` }).querySelector("small")?.textContent ?? "";

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

    expect(screen.getByText("Market 312 → 355 $M")).toBeInTheDocument();
    expect(screen.getAllByText(/→/)).toHaveLength(1);
  });

  it("says where the market is, not a move too small to show", () => {
    render(<PredictDialog {...props()} preview={{ [GERWIG.toLowerCase()]: { from: 312, to: 312.0001 } }} />);

    expect(screen.queryByText(/→/)).toBeNull();
    expect(screen.getByText("Market at 312 $M")).toBeInTheDocument();
  });

  it("lists each estimate with which way it moves the market", () => {
    render(<PredictDialog {...props()} />);

    expect(screen.getByText("Greta Gerwig")).toBeInTheDocument();
    expect(screen.getByText("400 $M")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "above the market" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "below the market" })).toBeInTheDocument();
    expect(screen.queryByText(/than the market/)).toBeNull();
  });

  it("counts the estimates beside the title", () => {
    render(<PredictDialog {...props()} />);

    expect(screen.getByText("2 estimates")).toBeInTheDocument();
  });

  it("drops an estimate the visitor takes out here", async () => {
    const onRemove = vi.fn();
    render(<PredictDialog {...props()} onRemove={onRemove} />);

    await userEvent.click(screen.getByRole("button", { name: "Remove Greta Gerwig" }));

    await waitFor(() => expect(onRemove).toHaveBeenCalledWith(GERWIG));
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

  it("says once what the total is and where it comes from", () => {
    render(<PredictDialog {...props()} />);

    expect(screen.getByText("10 sDAI = 6 in your trade wallet + 4 from your wallet")).toBeInTheDocument();
  });

  it("fills the whole balance on Max", async () => {
    const onAmountChange = vi.fn();
    render(<PredictDialog {...props()} onAmountChange={onAmountChange} />);

    await userEvent.click(screen.getByRole("button", { name: "Max" }));

    expect(onAmountChange).toHaveBeenCalledWith(25n * WAD);
  });

  it("refuses an amount larger than the balance", () => {
    render(<PredictDialog {...props()} amount={26n * WAD} />);

    expect(screen.getByText("Not enough balance. Max 25 sDAI.")).toBeInTheDocument();
    expect(screen.queryByText(/26 sDAI/)).toBeNull();
    expect(screen.getByRole("button", { name: "Predict" })).toBeDisabled();
  });

  it.each([
    ["an empty balance", 0n, "Balance: 0 sDAI"],
    ["a balance under the last shown decimal", WAD / 100_000n, "Balance: less than 0.0001 sDAI"],
  ])("names no Max over %s", (_name, available, balance) => {
    render(<PredictDialog {...props()} amount={WAD} funding={funding({ available })} />);

    expect(screen.getByText(balance)).toBeInTheDocument();
    expect(screen.getByText("Not enough balance.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Max" })).toBeDisabled();
  });

  it("does not ask for more money while a stopped run waits on the amount it started with", () => {
    render(<PredictDialog {...props()} amount={26n * WAD} canRetry />);

    expect(screen.queryByText(/Not enough balance/)).toBeNull();
    expect(screen.getByRole("button", { name: "Try the rest" })).toBeEnabled();
  });

  it("says a returning visitor's prediction adds nothing when no amount is typed", () => {
    render(<PredictDialog {...props()} amount={undefined} isFirstPrediction={false} />);

    expect(screen.getByText("You've predicted before, so you can change it without adding funds.")).toBeInTheDocument();
  });

  it("does not call a balance it has not read yet zero", () => {
    render(<PredictDialog {...props()} funding={null} />);

    expect(screen.getByText("Reading balance…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Predict" })).toBeDisabled();
  });

  it("asks for optional extra funds once the visitor has predicted before", () => {
    render(<PredictDialog {...props()} isFirstPrediction={false} />);

    expect(screen.getByText("Extra funds")).toBeInTheDocument();
    expect(screen.getByText("optional")).toBeInTheDocument();
    expect(screen.queryByText("You pay")).toBeNull();
  });

  it("offers no Max with nothing to spend", () => {
    render(<PredictDialog {...props()} amount={undefined} funding={funding({ available: 0n })} />);

    expect(screen.getByRole("button", { name: "Max" })).toBeDisabled();
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
    expect(subtitleOf("Add funds")).toBe("4 sDAI");
    expect(screen.getByText("Place prediction")).toBeInTheDocument();
  });

  it("starts the run on Predict", async () => {
    const onPredict = vi.fn();
    render(<PredictDialog {...props()} onPredict={onPredict} />);

    await userEvent.click(screen.getByRole("button", { name: "Predict" }));

    expect(onPredict).toHaveBeenCalled();
  });

  it("asks for what is missing before it can predict", () => {
    render(<PredictDialog {...props()} notice="Switch to Gnosis to predict." />);

    expect(screen.getByRole("status")).toHaveTextContent("Switch to Gnosis to predict.");
    expect(screen.getByRole("button", { name: "Predict" })).toBeDisabled();
  });

  it("shows no disclaimer about how far the market moves", () => {
    render(<PredictDialog {...props()} />);

    expect(screen.queryByText(/pool fee/)).toBeNull();
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
        steps={{ ...steps, failure: "You declined in your wallet." }}
        onPredict={onPredict}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("You declined in your wallet.");
    await userEvent.click(screen.getByRole("button", { name: "Predict" }));
    expect(onPredict).toHaveBeenCalled();
  });

  it("offers to check a sent transaction that has not confirmed, not to try the rest", () => {
    render(<PredictDialog {...props()} canRetry isPending />);

    expect(screen.getByRole("button", { name: "Check again" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Try the rest" })).not.toBeInTheDocument();
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
          failure: "The trade did not go through at these prices.",
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
    render(<PredictDialog {...props()} canRetry notice="Switch to Gnosis to predict." />);

    expect(screen.getByRole("button", { name: "Try the rest" })).toBeDisabled();
  });

  it("shows a stored run's own deposit in the locked amount form, and offers only Resume", async () => {
    const onPredict = vi.fn();
    render(
      <PredictDialog
        {...props()}
        selected={[{ scale: scale(GERWIG, "Greta Gerwig"), value: 410 }]}
        recovered={{ deposit: 7_250_000_000_000_000_001n, token: sDai }}
        canRetry
        onPredict={onPredict}
      />,
    );

    expect(screen.getByLabelText("Amount")).toHaveValue("7.250000000000000001");
    expect(screen.getByText("Locked to the amount this prediction started with.")).toBeInTheDocument();
    // the form's balance is in the form's token, not necessarily the stored run's
    expect(screen.queryByText(/^Balance: /)).toBeNull();
    expect(screen.getByText("410 $M")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Max" }).classList.contains("invisible")).toBe(true);
    expect(screen.queryByRole("button", { name: "Predict" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(onPredict).toHaveBeenCalled();
  });

  it("offers no remove on a stored run's estimates", () => {
    render(<PredictDialog {...props()} recovered={{ deposit: WAD, token: sDai }} canRetry />);

    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
  });

  it("will not resume a stored run that cannot be picked up", () => {
    render(<PredictDialog {...props()} recovered={{ deposit: WAD, token: sDai }} canRetry={false} />);

    expect(screen.getByRole("button", { name: "Resume" })).toBeDisabled();
  });

  it("says which estimates were left out", () => {
    render(<PredictDialog {...props()} skipped={1} />);

    expect(screen.getByRole("status")).toHaveTextContent("1 estimate could not be traded and was left out.");
  });
});

describe("what the funds step says is added", () => {
  const xDai = { id: "native" as const, symbol: "xDAI", decimals: 18 };
  const wallet = { address: "0xdcee0000000000000000000000000000000c664f", deployed: true } as const;

  it("names an xDAI payment in xDAI, with the sDAI it becomes", () => {
    // 900 xDAI at 1.254273999999999999 xDAI per sDAI is 717.546564785684787149 sDAI
    const paid = planFunding({
      amount: 900n * WAD,
      ownWallet: 1000n * WAD,
      tradeWallet: 0n,
      tokenPerCollateralWad: 1_254273999999999999n,
    });
    const shown = predictSteps({ wallet, ...fundsToAdd(paid, xDai, sDai), progress: null });

    render(
      <PredictDialog
        {...props()}
        tokens={[sDai, xDai]}
        token={xDai}
        amount={900n * WAD}
        funding={paid}
        steps={shown}
      />,
    );

    expect(subtitleOf("Add funds")).toBe("900 xDAI (≈ 717.5466 sDAI)");
  });

  it("names an sDAI payment in sDAI alone", () => {
    const paid = planFunding({ amount: 10n * WAD, ownWallet: 25n * WAD, tradeWallet: 0n });
    const shown = predictSteps({ wallet, ...fundsToAdd(paid, sDai, sDai), progress: null });

    render(<PredictDialog {...props()} funding={paid} steps={shown} />);

    expect(subtitleOf("Add funds")).toBe("10 sDAI");
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

  it.each(["sDAI", "xDAI"])("leaves the %s funds step without an amount", (symbol) => {
    render(
      <PredictDialog
        {...props()}
        isFirstPrediction={false}
        amount={undefined}
        funding={funding({ collateralIn: 0n, fromTradeWallet: 0n, toAdd: 0n, deposit: 0n })}
        steps={nothingToAdd(symbol)}
      />,
    );

    expect(subtitleOf("Add funds")).toBe("");
  });
});

describe("the dialog's accessible name", () => {
  it("says it is the prediction, not the library's default", () => {
    render(<PredictDialog {...props()} />);

    expect(screen.getByRole("dialog", { name: /predict/i })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Modal" })).toBeNull();
  });
});

describe("the spine's two input nodes", () => {
  const nodeBullet = (title: string) =>
    screen.getByText(title).closest("[data-spine-node]")?.querySelector("[data-bullet]")?.getAttribute("data-bullet");

  it.each([
    ["at rest", {}, "idle"],
    ["while a run goes", { isRunning: true }, "done"],
    ["when a stopped run can be picked up", { canRetry: true }, "done"],
  ])("are %s %s", (_name, state, view) => {
    render(<PredictDialog {...props()} {...state} />);

    expect(nodeBullet("2 estimates")).toBe(view);
    expect(nodeBullet("You pay")).toBe(view);
  });

  it("titles the estimates node with their count", () => {
    render(<PredictDialog {...props()} selected={selected.slice(0, 1)} />);

    expect(screen.getByText("1 estimate")).toBeInTheDocument();
  });
});

describe("what a run shows while it goes", () => {
  it("holds the balance, the summary and the market captions it locked with", () => {
    const preview = { [GERWIG.toLowerCase()]: { from: 312, to: 355 } };
    const view = render(<PredictDialog {...props()} preview={preview} isRunning />);

    view.rerender(
      <PredictDialog
        {...props()}
        isRunning
        preview={{ [GERWIG.toLowerCase()]: { from: 312, to: 340 } }}
        funding={funding({ available: 30n * WAD, tradeWallet: 2n * WAD, fromTradeWallet: 2n * WAD, toAdd: 8n * WAD })}
      />,
    );

    expect(screen.getByText("Balance: 25 sDAI")).toBeInTheDocument();
    expect(screen.getByText("10 sDAI = 6 in your trade wallet + 4 from your wallet")).toBeInTheDocument();
    expect(screen.getByText("Market 312 → 355 $M")).toBeInTheDocument();
  });

  it("reads them again once the run is over", () => {
    const view = render(<PredictDialog {...props()} isRunning />);

    view.rerender(<PredictDialog {...props()} funding={funding({ available: 30n * WAD })} />);

    expect(screen.getByText("Balance: 30 sDAI")).toBeInTheDocument();
  });

  it("brings a failure in with the entrance motion", () => {
    const view = render(<PredictDialog {...props()} />);
    expect(within(screen.getByRole("status")).queryByText(/./)).toBeNull();

    view.rerender(<PredictDialog {...props()} steps={{ ...steps, failure: "You declined in your wallet." }} />);

    expect(within(screen.getByRole("status")).getByText("You declined in your wallet.")).toHaveClass("fs-enter");
  });
});
