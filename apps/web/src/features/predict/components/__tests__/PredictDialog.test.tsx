import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SHOWN } from "@/test/queries";
import type { OptionScale } from "@/types/optionScale";

import type { SelectedEstimate } from "../../types";
import { planFunding, type Funding } from "../../utils/funding";
import { fundsToAdd, predictSteps, type PredictSteps } from "../../utils/predictSteps";
import type { SlippageSettings } from "../../utils/slippage";
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
  creditsAvailable: 0n,
  credits: [],
  creditsIn: 0n,
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

/** Before the run's first step, while its routes are priced. */
const pricing = predictSteps({
  wallet: { address: "0xdcee0000000000000000000000000000000c664f", deployed: false },
  toAdd: 4n * WAD,
  symbol: "sDAI",
  decimals: 18,
  progress: {
    stage: "quoting",
    steps: [
      { id: "create-wallet", label: "", state: "pending" },
      { id: "deposit", label: "", state: "pending" },
      { id: "predict-1", label: "", state: "pending" },
    ],
    leftOut: [],
    batchesDone: 0,
    batches: 1,
  },
});

const subtitleOf = (title: string) =>
  screen.getByRole("listitem", { name: `Timeline item: ${title}` }).querySelector("h2 + p")?.textContent ?? "";

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
  optionNoun: "director",
  isFirstPrediction: true,
  steps,
  leftOut: 0,
  isRunning: false,
  canRetry: false,
  slippage: { settings: { tradeBps: null, creditsBps: null } as SlippageSettings, onChange: vi.fn() },
  pricesReady: true,
  onPredict: vi.fn(),
});

/** A visitor holding credits they are spending. */
const withCredits = {
  credits: {
    offer: { state: "usable" as const, held: 4n * WAD, usable: 4n * WAD },
    isUsing: true,
    onUsingChange: vi.fn(),
  },
};

/** A credits swap of 100 credits paying 87 xDAI against 125 of vault value. */
const lossySwap = {
  credits: 100n * WAD,
  preview: {
    amount: 87n * WAD,
    creditsBps: 20,
    quoted: 87n * WAD,
    vaultValue: 125n * WAD,
    floor: 86n * WAD,
    loss: 38n * WAD,
    minted: 69n * WAD,
  },
};

const MOVED = { markets: 1, credits: false };

const summaryHead = () => within(screen.getByTestId("predict-summary")).getAllByRole("button")[0]!;

describe("the estimates going in", () => {
  it("says where each market would move, once the summary is opened", async () => {
    render(<PredictDialog {...props()} preview={{ [GERWIG.toLowerCase()]: { from: 312, to: 355 } }} />);
    const markets = () => screen.queryByRole("list", { name: "Markets" });
    expect(markets()).toBeNull();

    await userEvent.click(summaryHead());

    expect(
      within(markets()!)
        .getAllByTestId("market-move")
        .map((move) => move.textContent),
    ).toEqual(["312 → 355 $M", "Now 296 $M"]);
  });

  it("marks the mint as an estimate when paying in xDAI", async () => {
    const xDai = { id: "native" as const, symbol: "xDAI", decimals: 18 };
    render(<PredictDialog {...props()} tokens={[sDai, xDai]} token={xDai} />);

    await userEvent.click(summaryHead());

    expect(screen.getByTestId("trade-mint")).toHaveTextContent(/^Mint≈ 10 sDAI → ≈ 10 tokens of every director$/);
  });

  it("says where the market stays, not a move too small to show", async () => {
    render(<PredictDialog {...props()} preview={{ [GERWIG.toLowerCase()]: { from: 312, to: 312.0001 } }} />);

    await userEvent.click(summaryHead());

    expect(screen.getAllByTestId("market-move")[0]).toHaveTextContent(/^Stays at 312 \$M$/);
  });

  it("lists each estimate with which way it moves the market", () => {
    render(<PredictDialog {...props()} />);

    expect(screen.getByText("Greta Gerwig", SHOWN)).toBeInTheDocument();
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

    expect(screen.getByTitle("Balance: 25 sDAI")).toBeInTheDocument();
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

    expect(screen.getByTitle(balance)).toHaveTextContent(balance);
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

  it("asks for extra funds once the visitor has predicted before, its summary line saying they are optional", () => {
    render(<PredictDialog {...props()} isFirstPrediction={false} amount={undefined} />);

    expect(screen.getByRole("heading", { name: "Extra funds" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "You pay" })).toBeNull();
    expect(screen.getByText(/without adding funds/)).toBeInTheDocument();
    expect(screen.queryByText("optional")).toBeNull();
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

  it("offers no way out part way through, which would abandon work already on chain", async () => {
    const onClose = vi.fn();
    render(<PredictDialog {...props()} onClose={onClose} isRunning />);

    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    for (const remove of screen.getAllByRole("button", { name: /Remove/ })) expect(remove).toBeDisabled();
  });

  it("lets a run whose transaction is stored as sent be closed while it confirms, as recovery picks it up", async () => {
    const onClose = vi.fn();
    render(<PredictDialog {...props()} onClose={onClose} isRunning canClose />);

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
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
        recovered={{ deposit: 7_250_000_000_000_000_001n, token: sDai, slippage: { tradeBps: 100 } }}
        canRetry
        onPredict={onPredict}
      />,
    );

    expect(screen.getByLabelText("Amount")).toHaveValue("7.250000000000000001");
    expect(screen.getByText("Locked to this prediction's amount.")).toBeInTheDocument();
    // the form's balance is in the form's token, not necessarily the stored run's
    expect(screen.queryByTitle(/^Balance: /)).toBeNull();
    expect(screen.getByText("410 $M")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Max" }).classList.contains("invisible")).toBe(true);
    expect(screen.queryByRole("button", { name: "Predict" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(onPredict).toHaveBeenCalled();
  });

  it("names the sDAI a stored xDAI deposit becomes beside it, and no sDAI figure for an sDAI deposit", () => {
    const xDai = { id: "native" as const, symbol: "xDAI", decimals: 18 };
    const { rerender } = render(
      <PredictDialog
        {...props()}
        recovered={{ deposit: 4_375n * 10n ** 15n, token: xDai, deposited: 4n * WAD, slippage: { tradeBps: 100 } }}
        canRetry
      />,
    );

    expect(screen.getByText("Locked to this prediction's amount; the deposit ≈ 4 sDAI.")).toBeInTheDocument();
    rerender(
      <PredictDialog
        {...props()}
        recovered={{ deposit: 4n * WAD, token: sDai, slippage: { tradeBps: 100 } }}
        canRetry
      />,
    );
    expect(screen.getByText("Locked to this prediction's amount.")).toBeInTheDocument();
  });

  it("offers no remove on a stored run's estimates", () => {
    render(
      <PredictDialog {...props()} recovered={{ deposit: WAD, token: sDai, slippage: { tradeBps: 100 } }} canRetry />,
    );

    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
  });

  it("will not resume a stored run that cannot be picked up", () => {
    render(
      <PredictDialog
        {...props()}
        recovered={{ deposit: WAD, token: sDai, slippage: { tradeBps: 100 } }}
        canRetry={false}
      />,
    );

    expect(screen.getByRole("button", { name: "Resume" })).toBeDisabled();
  });

  it("says which estimates were left out", () => {
    render(<PredictDialog {...props()} leftOut={1} />);

    expect(screen.getByRole("status")).toHaveTextContent("1 estimate could not be traded.");
  });
});

describe("what the funds step says is added", () => {
  const xDai = { id: "native" as const, symbol: "xDAI", decimals: 18 };
  const wallet = { address: "0xdcee0000000000000000000000000000000c664f", deployed: true } as const;

  it("names an xDAI payment in xDAI alone", () => {
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

    expect(subtitleOf("Add funds")).toBe("900 xDAI");
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

describe("the header's close button", () => {
  it.each([
    ["at rest", {}],
    ["after a run stopped", { canRetry: true, steps: { ...steps, failure: "You declined in your wallet." } }],
    ["while a sent transaction is unconfirmed", { canRetry: true, isPending: true }],
  ])("closes the popup %s", async (_name, state) => {
    const onClose = vi.fn();
    render(<PredictDialog {...props()} {...state} onClose={onClose} />);

    await userEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape at rest", async () => {
    const onClose = vi.fn();
    render(<PredictDialog {...props()} onClose={onClose} />);

    await userEvent.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalled();
  });

  it("titles the estimates panel with their count", () => {
    render(<PredictDialog {...props()} selected={selected.slice(0, 1)} />);

    expect(screen.getByText("1 estimate")).toBeInTheDocument();
  });
});

describe("the button while a run goes", () => {
  const running: PredictSteps = {
    rows: [
      { key: "wallet", title: "Trade wallet", subtitle: "0xdcee…664f", view: "done" },
      { key: "funds", title: "Add funds", subtitle: "", view: "inactive" },
      { key: "predict", title: "Place prediction", subtitle: "1 of 2 · Confirm in your wallet", view: "running" },
    ],
    started: true,
  };

  it("keeps a label, what the run waits on, beside a spinner, and cannot be pressed", () => {
    render(<PredictDialog {...props()} isRunning steps={running} />);
    const button = screen.getByRole("button", { name: "Confirm in your wallet" });

    expect(button).toBeDisabled();
    expect(within(button).getByText("Confirm in your wallet")).not.toHaveClass("invisible");
    expect(within(button).getByTestId("predict-spinner")).toBeInTheDocument();
  });

  it("names the trade wallet's setup while that step reads the chain before the wallet opens", () => {
    const settingUp = predictSteps({
      wallet: { address: "0xdcee0000000000000000000000000000000c664f", deployed: false },
      toAdd: 4n * WAD,
      symbol: "sDAI",
      decimals: 18,
      progress: {
        stage: "quoting",
        steps: [
          { id: "create-wallet", label: "", state: "running" },
          { id: "deposit", label: "", state: "pending" },
          { id: "predict-1", label: "", state: "pending" },
        ],
        leftOut: [],
        batchesDone: 0,
        batches: 1,
      },
    });
    render(<PredictDialog {...props()} isRunning steps={settingUp} />);

    expect(screen.getByRole("button", { name: "Setting up…" })).toBeDisabled();
  });

  it("goes back to its own label, with no spinner, once the run stops", () => {
    const view = render(<PredictDialog {...props()} isRunning steps={running} />);

    view.rerender(
      <PredictDialog {...props()} canRetry steps={{ ...steps, failure: "You declined in your wallet." }} />,
    );

    expect(screen.getByRole("button", { name: "Try the rest" })).toBeEnabled();
    expect(screen.queryByTestId("predict-spinner")).toBeNull();
  });
});

describe("the summary under the amount", () => {
  it("counts the markets this prediction moves", () => {
    render(
      <PredictDialog
        {...props()}
        preview={{ [GERWIG.toLowerCase()]: { from: 312, to: 355 }, [COOGLER.toLowerCase()]: { from: 296, to: 280 } }}
      />,
    );

    expect(summaryHead()).toHaveTextContent("2 markets move");
    expect(summaryHead()).toHaveAttribute("aria-expanded", "false");
  });

  it("says it is checking prices on the summary and the button, with every step still waiting", () => {
    render(<PredictDialog {...props()} isRunning steps={pricing} />);

    expect(summaryHead()).toHaveTextContent("Checking prices…");
    expect(screen.getByTestId("pricing-sweep")).toBeInTheDocument();
    expect(document.querySelector(".predict-footer > .predict-cta")).toHaveTextContent("Checking prices…");
    expect(document.querySelector(".predict-footer > .predict-cta")).toHaveAttribute("data-busy", "true");
    expect(subtitleOf("Place prediction")).toBe("");
  });

  it("leaves a batch quoting mid-run to its step, with the summary and button as they are", () => {
    const quoting = predictSteps({
      wallet: { address: "0xdcee0000000000000000000000000000000c664f", deployed: true },
      ...fundsToAdd(funding(), sDai, sDai),
      progress: {
        stage: "quoting",
        steps: [
          { id: "predict-1", label: "", state: "success" },
          { id: "predict-2", label: "", state: "running" },
        ],
        leftOut: [],
        batchesDone: 1,
        batches: 2,
      },
    });
    render(
      <PredictDialog
        {...props()}
        isRunning
        steps={quoting}
        preview={{ [GERWIG.toLowerCase()]: { from: 312, to: 355 } }}
      />,
    );

    expect(subtitleOf("Place prediction")).toBe("2 of 2 · Checking prices…");
    expect(summaryHead()).toHaveTextContent("1 market moves");
    expect(screen.queryByTestId("pricing-sweep")).toBeNull();
    expect(screen.getByRole("button", { name: "Checking prices…" })).toHaveAttribute("data-busy", "true");
  });

  it("lists only figures the app computes: the mint and each market's move, and no minimum or time", async () => {
    render(<PredictDialog {...props()} preview={{ [GERWIG.toLowerCase()]: { from: 312, to: 355 } }} />);

    await userEvent.click(summaryHead());
    const summary = screen.getByTestId("predict-summary");

    expect(summaryHead().textContent).toBe("1 market moves");
    expect(screen.getByTestId("trade-mint")).toHaveTextContent(/^Mint10 sDAI → 10 tokens of every director$/);
    expect(
      within(summary)
        .getAllByRole("listitem")
        .map((row) => row.textContent),
    ).toEqual(["Greta Gerwig312 → 355 $M", "Ryan CooglerNow 296 $M"]);
  });

  it("holds the mint it showed when a run started while the balance refreshes", async () => {
    const view = render(<PredictDialog {...props()} />);
    await userEvent.click(summaryHead());

    view.rerender(<PredictDialog {...props()} isRunning />);
    view.rerender(<PredictDialog {...props()} isRunning funding={funding({ collateralIn: 3n * WAD })} />);

    expect(screen.getByTestId("trade-mint")).toHaveTextContent("10 sDAI → 10 tokens");
  });

  it("holds the mint it showed at Predict through moved and the Confirm after it, which sign that funding", async () => {
    const view = render(<PredictDialog {...props()} />);
    await userEvent.click(summaryHead());
    const refreshed = funding({ collateralIn: 3n * WAD });

    view.rerender(<PredictDialog {...props()} isRunning />);
    view.rerender(<PredictDialog {...props()} moved={{ markets: 1, credits: false }} funding={refreshed} />);
    expect(screen.getByTestId("trade-mint")).toHaveTextContent("10 sDAI → 10 tokens");
    view.rerender(<PredictDialog {...props()} isRunning funding={refreshed} />);

    expect(screen.getByTestId("trade-mint")).toHaveTextContent("10 sDAI → 10 tokens");
  });

  it("names no mint with nothing going in", async () => {
    render(<PredictDialog {...props()} funding={funding({ collateralIn: 0n })} />);

    await userEvent.click(summaryHead());

    expect(screen.queryByTestId("trade-mint")).toBeNull();
  });

  it("names no mint for a stored run, which minted what it stored", async () => {
    render(
      <PredictDialog
        {...props()}
        recovered={{ deposit: 4n * WAD, token: sDai, slippage: { tradeBps: 100 } }}
        canRetry
      />,
    );

    await userEvent.click(summaryHead());

    expect(screen.queryByTestId("trade-mint")).toBeNull();
  });

  it("stays open or closed as the visitor left it, whatever the run does", async () => {
    const preview = { [GERWIG.toLowerCase()]: { from: 312, to: 355 } };
    const view = render(<PredictDialog {...props()} preview={preview} />);
    await userEvent.click(summaryHead());

    view.rerender(<PredictDialog {...props()} preview={preview} isRunning steps={pricing} />);
    expect(summaryHead()).toHaveAttribute("aria-expanded", "true");
    view.rerender(<PredictDialog {...props()} preview={preview} isRunning />);
    expect(summaryHead()).toHaveAttribute("aria-expanded", "true");
    view.rerender(
      <PredictDialog
        {...props()}
        preview={preview}
        canRetry
        steps={{ ...steps, failure: "You declined in your wallet." }}
      />,
    );
    expect(summaryHead()).toHaveAttribute("aria-expanded", "true");

    await userEvent.click(summaryHead());
    view.rerender(<PredictDialog {...props()} preview={preview} isRunning />);
    expect(summaryHead()).toHaveAttribute("aria-expanded", "false");
    view.rerender(
      <PredictDialog
        {...props()}
        preview={preview}
        canRetry
        steps={{ ...steps, failure: "You declined in your wallet." }}
      />,
    );
    expect(summaryHead()).toHaveAttribute("aria-expanded", "false");
    view.rerender(<PredictDialog {...props()} preview={preview} canRetry isPending />);
    expect(summaryHead()).toHaveAttribute("aria-expanded", "false");
    view.rerender(
      <PredictDialog
        {...props()}
        preview={preview}
        recovered={{ deposit: 4n * WAD, token: sDai, slippage: { tradeBps: 100 } }}
      />,
    );
    expect(summaryHead()).toHaveAttribute("aria-expanded", "false");
  });

  it("can be opened while a run goes, to read the moves it locked with", async () => {
    render(<PredictDialog {...props()} isRunning />);

    await userEvent.click(summaryHead());

    expect(summaryHead()).toHaveAttribute("aria-expanded", "true");
  });
});

describe("what a run shows while it goes", () => {
  it("holds the balance, the funding line and the market moves it locked with", async () => {
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

    expect(screen.getByTitle("Balance: 25 sDAI")).toBeInTheDocument();
    expect(screen.getByText("10 sDAI = 6 in your trade wallet + 4 from your wallet")).toBeInTheDocument();
    await userEvent.click(summaryHead());
    expect(screen.getByText("312 → 355 $M")).toBeInTheDocument();
  });

  it("reads them again once the run is over", () => {
    const view = render(<PredictDialog {...props()} isRunning />);

    view.rerender(<PredictDialog {...props()} funding={funding({ available: 30n * WAD })} />);

    expect(screen.getByTitle("Balance: 30 sDAI")).toBeInTheDocument();
  });

  it("brings a failure in with the entrance motion", () => {
    const view = render(<PredictDialog {...props()} />);
    expect(within(screen.getByRole("status")).queryByText(/./)).toBeNull();

    view.rerender(<PredictDialog {...props()} steps={{ ...steps, failure: "You declined in your wallet." }} />);

    expect(within(screen.getByRole("status")).getByText("You declined in your wallet.")).toBeInTheDocument();
    expect(within(screen.getByRole("status")).getByTestId("status-box")).toHaveClass("fs-enter");
  });

  it("marks each status with its tone's glyph, and a check in progress with a clock", () => {
    const glyph = () => within(screen.getByRole("status")).getByTestId("status-glyph").getAttribute("data-glyph");
    const view = render(<PredictDialog {...props()} steps={{ ...steps, failure: "You declined in your wallet." }} />);
    expect(glyph()).toBe("error");

    view.rerender(<PredictDialog {...props()} steps={{ ...steps, note: "Checking your last transaction…" }} />);
    expect(glyph()).toBe("waiting");
    expect(screen.getByRole("status")).toHaveAttribute("data-tone", "neutral");
  });
});

describe("the settings", () => {
  const gear = () => screen.getByRole("button", { name: "Settings" });
  const panel = () => document.getElementById(gear().getAttribute("aria-controls")!)!;

  it("open over the body from the gear in the header, titled Settings, with the first choice focused", async () => {
    render(<PredictDialog {...props()} />);

    await userEvent.click(gear());

    expect(gear()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("heading", { level: 2, name: "Settings" })).toBeInTheDocument();
    expect(panel()).not.toHaveAttribute("inert");
    expect(within(panel()).getAllByRole("button", { name: "Auto" })[0]).toHaveFocus();
  });

  it("keep the body out of reach while open", async () => {
    render(<PredictDialog {...props()} />);

    await userEvent.click(gear());

    expect(screen.getByTestId("predict-body").closest("[inert]")).not.toBeNull();
  });

  it("are out of reach while closed", () => {
    render(<PredictDialog {...props()} />);

    expect(panel()).toHaveAttribute("inert");
    expect(screen.getByTestId("predict-body").closest("[inert]")).toBeNull();
  });

  it("close on Escape, leaving the popup open and the focus back on the gear", async () => {
    const onClose = vi.fn();
    render(<PredictDialog {...props()} onClose={onClose} />);
    await userEvent.click(gear());

    await userEvent.keyboard("{Escape}");

    expect(gear()).toHaveAttribute("aria-expanded", "false");
    expect(gear()).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("save a custom trade slippage once the field is left, not while it is typed", async () => {
    const onChange = vi.fn();
    render(<PredictDialog {...props()} slippage={{ settings: { tradeBps: null, creditsBps: null }, onChange }} />);
    await userEvent.click(gear());

    await userEvent.type(screen.getByRole("textbox", { name: "Max slippage, custom percent" }), "2.5");
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.tab();

    expect(onChange).toHaveBeenCalledExactlyOnceWith("tradeBps", 250);
  });

  it("save a custom value on Enter", async () => {
    const onChange = vi.fn();
    render(<PredictDialog {...props()} slippage={{ settings: { tradeBps: null, creditsBps: null }, onChange }} />);
    await userEvent.click(gear());

    await userEvent.type(screen.getByRole("textbox", { name: "Max slippage, custom percent" }), "3{Enter}");

    expect(onChange).toHaveBeenCalledExactlyOnceWith("tradeBps", 300);
  });

  it("go back to Auto from the Auto button", async () => {
    const onChange = vi.fn();
    render(
      <PredictDialog
        {...props()}
        {...withCredits}
        slippage={{ settings: { tradeBps: null, creditsBps: 50 }, onChange }}
      />,
    );
    await userEvent.click(gear());
    const credits = within(document.querySelector<HTMLElement>('[data-slippage="creditsBps"]')!);

    expect(credits.getByRole("button", { name: "Auto" })).toHaveAttribute("aria-pressed", "false");
    expect(credits.getByRole("textbox")).toHaveValue("0.5");
    await userEvent.click(credits.getByRole("button", { name: "Auto" }));

    expect(onChange).toHaveBeenLastCalledWith("creditsBps", null);
  });

  it("keep an out-of-range entry and its error once the field is left, saving nothing", async () => {
    const onChange = vi.fn();
    render(<PredictDialog {...props()} slippage={{ settings: { tradeBps: null, creditsBps: null }, onChange }} />);
    await userEvent.click(gear());
    const field = screen.getByRole("textbox", { name: "Max slippage, custom percent" });

    await userEvent.type(field, "60");
    expect(field).not.toHaveAttribute("aria-invalid");
    await userEvent.tab();

    expect(onChange).not.toHaveBeenCalled();
    expect(field).toHaveValue("60");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription(/Enter a percent from 0\.01 to 50\.$/);
  });

  it("offer Reset while a field holds an entry it refused, and go back to Auto from it", async () => {
    render(<PredictDialog {...props()} />);
    await userEvent.click(gear());
    const field = screen.getByRole("textbox", { name: "Max slippage, custom percent" });
    await userEvent.type(field, "99");
    await userEvent.tab();

    await userEvent.click(within(panel()).getByRole("button", { name: "Reset" }));

    const after = screen.getByRole("textbox", { name: "Max slippage, custom percent" });
    expect(after).toHaveValue("");
    expect(after).not.toHaveAttribute("aria-invalid");
    expect(within(panel()).getAllByRole("button", { name: "Auto" })[0]).toHaveAttribute("aria-pressed", "true");
  });

  it("drop an entry it refused when the panel closes, so it reopens on the slippage in use", async () => {
    render(<PredictDialog {...props()} />);
    await userEvent.click(gear());
    await userEvent.type(screen.getByRole("textbox", { name: "Max slippage, custom percent" }), "99");
    await userEvent.click(within(panel()).getByRole("button", { name: "Done" }));

    await userEvent.click(gear());

    const field = screen.getByRole("textbox", { name: "Max slippage, custom percent" });
    expect(field).toHaveValue("");
    expect(field).not.toHaveAttribute("aria-invalid");
    expect(within(panel()).getByRole("button", { name: "Reset" })).toBeDisabled();
  });

  it("show each setting's hint to every visitor", async () => {
    render(<PredictDialog {...props()} {...withCredits} />);
    await userEvent.click(gear());

    expect(within(panel()).getByText("How far a trade may fill from its plan.")).toBeVisible();
    expect(within(panel()).getByText("How far the swap may fill below its quote.")).toBeVisible();
  });

  it("refuse 0, at which no swap can fill", async () => {
    const onChange = vi.fn();
    render(<PredictDialog {...props()} slippage={{ settings: { tradeBps: null, creditsBps: null }, onChange }} />);
    await userEvent.click(gear());
    const field = screen.getByRole("textbox", { name: "Max slippage, custom percent" });

    await userEvent.type(field, "0");
    await userEvent.tab();

    expect(onChange).not.toHaveBeenCalled();
    expect(field).toHaveAttribute("aria-invalid", "true");
  });

  it("warn on a low custom value without refusing it", async () => {
    render(
      <PredictDialog {...props()} slippage={{ settings: { tradeBps: 5, creditsBps: null }, onChange: vi.fn() }} />,
    );
    await userEvent.click(gear());

    expect(screen.getByRole("textbox", { name: "Max slippage, custom percent" })).toHaveAccessibleDescription(
      /Low slippage\. A trade may fail if the pool moves at all\.$/,
    );
  });

  it("show the credits swap's setting only to a visitor with credits", async () => {
    const view = render(<PredictDialog {...props()} />);
    await userEvent.click(gear());
    expect(document.querySelector('[data-slippage="creditsBps"]')).toBeNull();

    view.rerender(<PredictDialog {...props()} {...withCredits} />);
    expect(document.querySelector('[data-slippage="creditsBps"]')).not.toBeNull();
  });

  it("close on Done and on the X beside the title, leaving the popup open", async () => {
    const onClose = vi.fn();
    render(<PredictDialog {...props()} onClose={onClose} />);

    await userEvent.click(gear());
    await userEvent.click(within(panel()).getByRole("button", { name: "Done" }));
    expect(gear()).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(gear());
    await userEvent.click(screen.getByRole("button", { name: "Close settings" }));
    expect(gear()).toHaveAttribute("aria-expanded", "false");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keep the keyboard in the header and the panel, Tab from the end to the gear and back", async () => {
    render(<PredictDialog {...props()} />);
    await userEvent.click(gear());
    const done = within(panel()).getByRole("button", { name: "Done" });

    done.focus();
    await userEvent.tab();
    expect(gear()).toHaveFocus();

    await userEvent.tab({ shift: true });
    expect(done).toHaveFocus();
  });

  it("warn on a high custom value without refusing it", async () => {
    render(
      <PredictDialog {...props()} slippage={{ settings: { tradeBps: 800, creditsBps: null }, onChange: vi.fn() }} />,
    );
    await userEvent.click(gear());

    expect(screen.getByRole("textbox", { name: "Max slippage, custom percent" })).toHaveAccessibleDescription(
      /High slippage\. A trade may fill at a much worse price\.$/,
    );
  });

  it("warn on a high credits swap slippage in the swap's own words", async () => {
    render(
      <PredictDialog
        {...props()}
        {...withCredits}
        slippage={{ settings: { tradeBps: null, creditsBps: 500 }, onChange: vi.fn() }}
      />,
    );
    await userEvent.click(gear());

    expect(screen.getByRole("textbox", { name: "Credits swap slippage, custom percent" })).toHaveAccessibleDescription(
      /High slippage\. The swap may pay much less than its quote\.$/,
    );
  });

  it("show the slippage in use on Auto in each empty field, and name it", async () => {
    render(<PredictDialog {...props()} {...withCredits} />);
    await userEvent.click(gear());
    const trades = screen.getByRole("textbox", { name: "Max slippage, custom percent" });
    const credits = screen.getByRole("textbox", { name: "Credits swap slippage, custom percent" });

    expect(trades).toHaveValue("");
    expect(trades).toHaveAttribute("placeholder", "1");
    expect(trades).toHaveAccessibleDescription(/Auto is 1%\./);
    expect(credits).toHaveAttribute("placeholder", "0.2");
  });

  it("set every kind back to Auto from Reset, which has nothing to do on Auto", async () => {
    const onChange = vi.fn();
    const view = render(
      <PredictDialog
        {...props()}
        {...withCredits}
        slippage={{ settings: { tradeBps: null, creditsBps: null }, onChange }}
      />,
    );
    await userEvent.click(gear());
    expect(within(panel()).getByRole("button", { name: "Reset" })).toBeDisabled();

    view.rerender(
      <PredictDialog
        {...props()}
        {...withCredits}
        slippage={{ settings: { tradeBps: 300, creditsBps: 50 }, onChange }}
      />,
    );
    await userEvent.click(within(panel()).getByRole("button", { name: "Reset" }));

    expect(onChange.mock.calls).toEqual([
      ["tradeBps", null],
      ["creditsBps", null],
    ]);
  });

  it("drop a typed entry not yet saved on Reset", async () => {
    render(
      <PredictDialog {...props()} slippage={{ settings: { tradeBps: 300, creditsBps: null }, onChange: vi.fn() }} />,
    );
    await userEvent.click(gear());
    const field = screen.getByRole("textbox", { name: "Max slippage, custom percent" });
    await userEvent.clear(field);
    await userEvent.type(field, "70");
    await userEvent.tab();

    await userEvent.click(within(panel()).getByRole("button", { name: "Reset" }));

    const after = screen.getByRole("textbox", { name: "Max slippage, custom percent" });
    expect(after).not.toHaveAttribute("aria-invalid");
    expect(within(panel()).getAllByRole("button", { name: "Auto" })[0]).toHaveFocus();
  });

  it("close from the dimmed body around the panel", async () => {
    render(<PredictDialog {...props()} />);
    await userEvent.click(gear());

    await userEvent.click(panel());

    expect(gear()).toHaveAttribute("aria-expanded", "false");
  });

  it("mark the gear while a custom value applies, so the slippage in use is known without opening them", () => {
    const view = render(<PredictDialog {...props()} />);
    expect(gear()).not.toHaveAccessibleDescription();
    expect(screen.queryByTestId("settings-custom")).toBeNull();

    view.rerender(
      <PredictDialog {...props()} slippage={{ settings: { tradeBps: 300, creditsBps: null }, onChange: vi.fn() }} />,
    );
    expect(gear()).toHaveAccessibleDescription("Custom slippage set");
    expect(screen.getByTestId("settings-custom")).toBeInTheDocument();

    // a credits setting applies only to a visitor with credits
    view.rerender(
      <PredictDialog {...props()} slippage={{ settings: { tradeBps: null, creditsBps: 50 }, onChange: vi.fn() }} />,
    );
    expect(screen.queryByTestId("settings-custom")).toBeNull();
    view.rerender(
      <PredictDialog
        {...props()}
        {...withCredits}
        slippage={{ settings: { tradeBps: null, creditsBps: 50 }, onChange: vi.fn() }}
      />,
    );
    expect(screen.getByTestId("settings-custom")).toBeInTheDocument();
  });

  it("open after a run stopped with money moved, while the form stays locked to the run", async () => {
    render(<PredictDialog {...props()} canRetry />);

    expect(gear()).toBeEnabled();
    await userEvent.click(gear());
    expect(gear()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Amount")).toHaveAttribute("readonly");
  });

  it.each([
    ["while a run goes", { isRunning: true }],
    ["while a sent transaction is not confirmed", { canRetry: true, isPending: true }],
    ["for a stored run", { canRetry: true, recovered: { deposit: WAD, token: sDai, slippage: { tradeBps: 100 } } }],
    ["while new prices wait to be confirmed", { moved: MOVED }],
  ])("cannot be opened %s", (_name, state) => {
    render(<PredictDialog {...props()} {...state} />);

    expect(gear()).toBeDisabled();
  });
});

describe("prices that moved before signing", () => {
  it("ask for a confirm on the button and say what moved", () => {
    render(<PredictDialog {...props()} moved={{ markets: 2, credits: false }} />);

    expect(screen.getByRole("button", { name: "Confirm new prices" })).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent("Prices moved on 2 markets. Confirm to go on.");
  });

  it("name the one market that moved on the status line", () => {
    render(
      <PredictDialog
        {...props()}
        moved={MOVED}
        preview={{ [GERWIG.toLowerCase()]: { from: 312, to: 340, was: { from: 312, to: 355 } } }}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(/now goes to 340 \$M, not 355 \$M\. Confirm to go on\.$/);
  });

  it("does not name a market whose estimate is the one it was going to", () => {
    render(
      <PredictDialog
        {...props()}
        moved={MOVED}
        preview={{ [GERWIG.toLowerCase()]: { from: 312, to: 400, was: { from: 312, to: 400 } } }}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Prices moved on 1 market. Confirm to go on.");
  });

  it("say the visitor's new slippage changed the trades, where no price moved", () => {
    render(
      <PredictDialog
        {...props()}
        moved={{ markets: 1, credits: true, bySlippage: true }}
        preview={{ [GERWIG.toLowerCase()]: { from: 312, to: 400, was: { from: 312, to: 400 } } }}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Your new slippage changes the trades. Confirm to go on.");
    expect(screen.getByRole("button", { name: "Confirm trades" })).toBeEnabled();
  });

  it("open Details on the new figures", () => {
    const view = render(<PredictDialog {...props()} />);
    expect(summaryHead()).toHaveAttribute("aria-expanded", "false");

    view.rerender(<PredictDialog {...props()} moved={MOVED} />);

    expect(summaryHead()).toHaveAttribute("aria-expanded", "true");
  });

  it("go back to the form from beside the confirm", async () => {
    const onBack = vi.fn();
    render(<PredictDialog {...props()} moved={MOVED} onBack={onBack} />);

    await userEvent.click(screen.getByRole("button", { name: "Go back" }));

    expect(onBack).toHaveBeenCalledOnce();
  });

  it("lock the amount the new figures were planned from", () => {
    render(<PredictDialog {...props()} moved={MOVED} />);

    expect(screen.getByLabelText("Amount")).toHaveAttribute("readonly");
  });

  it("show the new figures, not the ones held before", () => {
    const view = render(<PredictDialog {...props()} preview={{ [GERWIG.toLowerCase()]: { from: 312, to: 355 } }} />);

    view.rerender(
      <PredictDialog {...props()} moved={MOVED} preview={{ [GERWIG.toLowerCase()]: { from: 312, to: 340 } }} />,
    );

    expect(within(screen.getByTestId("predict-summary")).getAllByTestId("market-move")[0]).toHaveTextContent(
      "312 → 340 $M",
    );
  });

  it("show the new figures when a running run stops at moved, not those held from its start", () => {
    const view = render(
      <PredictDialog {...props()} isRunning preview={{ [GERWIG.toLowerCase()]: { from: 312, to: 355 } }} />,
    );

    view.rerender(
      <PredictDialog {...props()} moved={MOVED} preview={{ [GERWIG.toLowerCase()]: { from: 312, to: 340 } }} />,
    );

    expect(within(screen.getByTestId("predict-summary")).getAllByTestId("market-move")[0]).toHaveTextContent(
      "312 → 340 $M",
    );
  });
});

describe("prices that could not be read", () => {
  const notice = "Prices could not be read.";

  it("offer Try again in Predict's place, which reads them again", async () => {
    const onRetryPrices = vi.fn();
    render(<PredictDialog {...props()} notice={notice} onRetryPrices={onRetryPrices} />);

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(onRetryPrices).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toHaveTextContent(notice);
  });

  it("check prices on the button while they are read again", () => {
    render(<PredictDialog {...props()} notice={notice} onRetryPrices={vi.fn()} isRetryingPrices />);

    expect(screen.getAllByRole("button", { name: "Checking prices…" }).at(-1)).toBeDisabled();
    expect(summaryHead()).toHaveTextContent("Checking prices…");
  });
});

describe("Predict before its prices are read", () => {
  it("holds Predict until Details has a plan for each estimate to hold the run to", () => {
    render(<PredictDialog {...props()} pricesReady={false} />);

    expect(screen.getByRole("button", { name: "Predict" })).toBeDisabled();
    expect(summaryHead()).toHaveTextContent("Checking prices…");
  });
});

describe("a credits swap that loses much", () => {
  it("names the loss on the status line without the visitor opening Details", () => {
    render(<PredictDialog {...props()} {...withCredits} creditsSwap={lossySwap} />);

    expect(screen.getByRole("status")).toHaveTextContent(/^Credits swap loses ≈ 38 xDAI\.$/);
    expect(within(screen.getByRole("status")).getByTestId("status-box")).toHaveAttribute("data-small");
    expect(screen.getByRole("button", { name: "Predict" })).toBeEnabled();
  });

  it("says nothing of a loss under 1% of the credits' value", () => {
    const small = { ...lossySwap, preview: { ...lossySwap.preview, loss: WAD } };
    render(<PredictDialog {...props()} {...withCredits} creditsSwap={small} />);

    expect(within(screen.getByRole("status")).queryByText(/./)).toBeNull();
  });
});

describe("Details' slippage", () => {
  const slippageRows = async () => {
    await userEvent.click(summaryHead());
    return screen.queryAllByTestId("slippage-row").map((row) => row.textContent);
  };

  it("names a stored run's own slippage, which Resume signs with, not the settings'", async () => {
    render(
      <PredictDialog
        {...props()}
        canRetry
        recovered={{ deposit: WAD, token: sDai, slippage: { tradeBps: 300 } }}
        slippage={{ settings: { tradeBps: 5_000, creditsBps: null }, onChange: vi.fn() }}
      />,
    );

    expect(await slippageRows()).toEqual(["Max slippage3%"]);
  });

  it("names a stored run's credits swap slippage while its swap is still to land", async () => {
    render(
      <PredictDialog
        {...props()}
        canRetry
        recovered={{ deposit: WAD, token: sDai, slippage: { tradeBps: 100, creditsBps: 50 } }}
      />,
    );

    expect(await slippageRows()).toEqual(["Max slippage1%", "Credits swap slippage0.5%"]);
  });

  it("leaves out the credits swap's slippage once the swap has landed", async () => {
    render(<PredictDialog {...props()} {...withCredits} canRetry creditsSwap={{ ...lossySwap, landed: true }} />);

    expect(await slippageRows()).toEqual(["Max slippage1%"]);
  });

  it("leaves it out once the swap lands part way through a run held to the swap shown at Predict", async () => {
    const view = render(<PredictDialog {...props()} {...withCredits} isRunning creditsSwap={lossySwap} />);
    view.rerender(
      <PredictDialog {...props()} {...withCredits} canRetry creditsSwap={{ ...lossySwap, landed: true }} />,
    );

    expect(await slippageRows()).toEqual(["Max slippage1%"]);
  });
});
