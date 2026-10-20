import { describe, expect, it } from "vitest";

import type { PredictProgress } from "../../run/types";
import { fundingSummary, planFunding } from "../funding";
import { fundsToAdd, predictSteps, statusLine } from "../predictSteps";

const WALLET = "0xdcee0000000000000000000000000000000c664f" as const;
const WAD = 10n ** 18n;

const progress = (overrides: Partial<PredictProgress> = {}): PredictProgress => ({
  stage: "quoting",
  steps: [
    { id: "create-wallet", label: "Set up your trade wallet", state: "success" },
    { id: "deposit", label: "Add money to your trade wallet", state: "success" },
    { id: "predict-1", label: "Making your prediction", state: "running" },
  ],
  leftOut: [],
  batchesDone: 0,
  batches: 1,
  ...overrides,
});

const steps = (args: Partial<Parameters<typeof predictSteps>[0]> = {}) =>
  predictSteps({
    wallet: { address: WALLET, deployed: false },
    toAdd: 4n * WAD,
    symbol: "sDAI",
    decimals: 18,
    progress: null,
    ...args,
  });

describe("predictSteps before a run", () => {
  it("offers to create the trade wallet, then add funds, then predict", () => {
    expect(steps().rows).toEqual([
      { key: "wallet", title: "Create a trade wallet", subtitle: "", view: "idle" },
      { key: "funds", title: "Add funds", subtitle: "4 sDAI", view: "idle" },
      { key: "predict", title: "Place prediction", subtitle: "", view: "idle" },
    ]);
  });

  it("names an existing trade wallet by its short address", () => {
    const [wallet] = steps({ wallet: { address: WALLET, deployed: true } }).rows;

    expect(wallet).toEqual({ key: "wallet", title: "Trade wallet", subtitle: "0xdcee...664f", view: "done" });
  });

  it("greys out adding funds when the trade wallet already covers the amount", () => {
    expect(steps({ toAdd: 0n }).rows[1]).toMatchObject({ view: "inactive", subtitle: "" });
  });

  it("never says it is adding 0 when the amount is below the shown decimals", () => {
    expect(steps({ toAdd: 15n * 10n ** 10n }).rows[1]?.subtitle).toBe("less than 0.0001 sDAI");
    // a single wei still reads as something being added
    expect(steps({ toAdd: 1n }).rows[1]?.subtitle).toBe("less than 0.0001 sDAI");
  });
});

describe("predictSteps naming what the funds step adds", () => {
  const SDAI = { id: "collateral", symbol: "sDAI", decimals: 18 } as const;
  const XDAI = { id: "native", symbol: "xDAI", decimals: 18 } as const;
  // the deposit for 900 xDAI at this rate rounds to 1 wei short of 900; the sDAI is 717.546564785684787149
  const XDAI_PER_SDAI = 1_254273999999999999n;

  it("names an sDAI payment in sDAI alone", () => {
    const funding = planFunding({ amount: 10n * WAD, ownWallet: 25n * WAD, tradeWallet: 0n });

    expect(steps(fundsToAdd(funding, SDAI, SDAI)).rows[1]?.subtitle).toBe("10 sDAI");
  });

  it("names an xDAI payment in xDAI alone, as the summary under the amount names the sDAI", () => {
    const funding = planFunding({
      amount: 900n * WAD,
      ownWallet: 1000n * WAD,
      tradeWallet: 0n,
      tokenPerCollateralWad: XDAI_PER_SDAI,
    });

    expect(steps(fundsToAdd(funding, XDAI, SDAI)).rows[1]?.subtitle).toBe("900 xDAI");
  });

  it("names only the xDAI the trade wallet does not already cover", () => {
    const funding = planFunding({
      amount: 900n * WAD,
      ownWallet: 1000n * WAD,
      tradeWallet: 100n * WAD,
      tokenPerCollateralWad: 1_250000000000000000n,
    });

    expect(steps(fundsToAdd(funding, XDAI, SDAI)).rows[1]?.subtitle).toBe("775 xDAI");
  });

  it("says nothing is added when the trade wallet covers an xDAI payment", () => {
    const funding = planFunding({
      amount: 900n * WAD,
      ownWallet: 1000n * WAD,
      tradeWallet: 720n * WAD,
      tokenPerCollateralWad: 1_250000000000000000n,
    });

    expect(steps(fundsToAdd(funding, XDAI, SDAI)).rows[1]).toMatchObject({ subtitle: "", view: "inactive" });
  });
});

describe("predictSteps during a run", () => {
  it("leaves every step waiting while the prices are checked before the run has a step going", () => {
    const pending = progress().steps.map((step) => ({ ...step, state: "pending" as const }));
    const checked = steps({ progress: progress({ stage: "quoting", steps: pending }) });

    expect(checked.pricing).toBe(true);
    expect(checked.rows.map((row) => [row.view, row.subtitle])).toEqual([
      ["idle", ""],
      ["idle", "4 sDAI"],
      ["idle", ""],
    ]);
  });

  it("keeps the prediction step running while a batch checks its prices mid-run", () => {
    const checked = steps({ progress: progress({ stage: "quoting" }) });

    expect(checked.pricing).toBeUndefined();
    expect(checked.rows[2]).toMatchObject({ view: "running", subtitle: "Checking prices…" });
  });

  it("says nothing of prices on the trade wallet step while it is prepared", () => {
    const creating = progress({
      stage: "quoting",
      steps: [
        { id: "create-wallet", label: "", state: "running" },
        { id: "predict-1", label: "", state: "pending" },
      ],
    });

    expect(steps({ progress: creating }).rows[0]).toMatchObject({ view: "running", subtitle: "" });
  });

  it("says to confirm in the wallet while it asks for a signature", () => {
    const rows = steps({ progress: progress({ stage: "signing" }) }).rows;

    expect(rows.map((row) => row.view)).toEqual(["done", "done", "running"]);
    expect(rows[2]?.subtitle).toBe("Confirm in your wallet");
  });

  it("counts the batches when a prediction takes more than one", () => {
    const rows = steps({
      progress: progress({
        stage: "confirming",
        steps: [
          { id: "create-wallet", label: "", state: "success" },
          { id: "predict-1", label: "", state: "success" },
          { id: "predict-2", label: "", state: "running" },
        ],
        batches: 2,
        batchesDone: 1,
      }),
    }).rows;

    expect(rows[2]?.subtitle).toBe("2 of 2 · Confirming…");
  });

  it("marks the prediction done once the run completes", () => {
    const rows = steps({
      progress: progress({
        stage: "complete",
        steps: [
          { id: "create-wallet", label: "", state: "success" },
          { id: "predict-1", label: "", state: "success" },
        ],
        batchesDone: 1,
      }),
    }).rows;

    expect(rows[2]).toMatchObject({ view: "done", subtitle: "" });
  });

  it("says why a stopped run stopped, and how much went through", () => {
    const result = steps({
      progress: progress({
        stage: "halted",
        steps: [
          { id: "predict-1", label: "", state: "success" },
          { id: "predict-2", label: "", state: "error" },
        ],
        batchesDone: 3,
        batches: 5,
        failure: { reason: "rejected", retryable: true },
      }),
    });

    expect(result.failure).toBe("You declined in your wallet.");
    expect(result.rows[2]).toMatchObject({ view: "failed", subtitle: "3 of 5 went through" });
  });

  it("marks the step that failed, not the prediction, when the deposit stops the run", () => {
    const rows = steps({
      progress: progress({
        stage: "halted",
        steps: [
          { id: "create-wallet", label: "", state: "success" },
          { id: "deposit", label: "", state: "error" },
          { id: "predict-1", label: "", state: "pending" },
        ],
        failure: { reason: "rejected", retryable: true },
      }),
    }).rows;

    expect(rows.map((row) => row.view)).toEqual(["done", "failed", "inactive"]);
  });

  it("crosses no step whose transaction was sent but has not confirmed", () => {
    const rows = steps({
      progress: progress({
        stage: "halted",
        steps: [
          { id: "create-wallet", label: "", state: "success" },
          { id: "deposit", label: "", state: "running" },
          { id: "predict-1", label: "", state: "pending" },
        ],
        failure: { reason: "rpc", retryable: true },
        pendingHash: `0x${"ab".repeat(32)}`,
      }),
    }).rows;

    expect(rows.map((row) => row.view)).not.toContain("failed");
  });

  it("marks the prediction failed when the run stops before any step", () => {
    const pending = progress().steps.map((step) => ({ ...step, state: "pending" as const }));
    const rows = steps({
      progress: progress({ stage: "halted", steps: pending, failure: { reason: "quote", retryable: true } }),
    }).rows;

    expect(rows[2]?.view).toBe("failed");
  });

  it("has no failure to report while the run is going", () => {
    expect(steps({ progress: progress() }).failure).toBeUndefined();
  });
});

describe("predictSteps while adding funds", () => {
  const depositing = (stage: PredictProgress["stage"]) =>
    progress({
      stage,
      steps: [
        { id: "create-wallet", label: "", state: "success" },
        { id: "deposit", label: "", state: "running" },
        { id: "predict-1", label: "", state: "pending" },
      ],
    });

  it.each([
    ["signing", "Confirm in your wallet"],
    ["confirming", "Confirming…"],
  ] as const)("shows Add funds running, without the amount, while %s", (stage, copy) => {
    const funds = steps({ progress: depositing(stage), toAdd: 4n * WAD }).rows[1];

    expect(funds?.view).toBe("running");
    expect(funds?.subtitle).toBe(copy);
  });
});

describe("the sDAI an xDAI payment becomes", () => {
  it("is said in the summary under the amount, and the funds step names the xDAI alone", () => {
    const xDai = { id: "native" as const, symbol: "xDAI", decimals: 18 };
    const sDai = { symbol: "sDAI", decimals: 18 };
    // 1.2543 xDAI per sDAI, so 1 xDAI is 0.79725... sDAI: truncating and rounding disagree in the 4th decimal
    const funding = planFunding({
      amount: WAD,
      ownWallet: 10n * WAD,
      tradeWallet: 0n,
      tokenPerCollateralWad: 12543n * 10n ** 14n,
    });

    const summary = fundingSummary({ funding, amount: WAD, token: xDai, collateral: sDai });
    const subtitle = predictSteps({ wallet: null, progress: null, ...fundsToAdd(funding, xDai, sDai) }).rows[1]
      ?.subtitle;

    expect(summary?.text).toBe("≈ 0.7973 sDAI from your wallet");
    expect(subtitle).toBe("1 xDAI");
  });
});

describe("statusLine", () => {
  const idle = steps();
  const halted = steps({ progress: progress({ stage: "halted", failure: { reason: "rpc", retryable: true } }) });

  it("says nothing before a run, nor once it has placed the prediction", () => {
    const placed = steps({
      progress: progress({
        stage: "complete",
        steps: progress().steps.map((step) => ({ ...step, state: "success" as const })),
      }),
    });

    expect(statusLine({ steps: idle, leftOut: 0 })).toBeNull();
    expect(placed.rows.find((row) => row.key === "predict")?.view).toBe("done");
    expect(statusLine({ steps: placed, leftOut: 0 })).toBeNull();
  });

  it("names the estimates a run left out, since they were not signed", () => {
    expect(statusLine({ steps: idle, leftOut: 2 })).toEqual({
      text: "2 estimates could not be traded.",
      tone: "neutral",
    });
    expect(statusLine({ steps: idle, leftOut: 1 })?.text).toBe("1 estimate could not be traded.");
  });

  it("asks the visitor to check Details when the pools moved, in the warning tone", () => {
    expect(statusLine({ steps: idle, leftOut: 0, moved: { markets: 2, credits: false } })).toEqual({
      text: "Prices moved on 2 markets. Check Details, then confirm.",
      tone: "warning",
    });
    expect(statusLine({ steps: idle, leftOut: 0, moved: { markets: 1, credits: false } })?.text).toBe(
      "Prices moved on 1 market. Check Details, then confirm.",
    );
    expect(statusLine({ steps: idle, leftOut: 0, moved: { markets: 1, credits: true } })?.text).toBe(
      "Prices moved on 1 market and the credits swap. Check Details, then confirm.",
    );
    expect(statusLine({ steps: idle, leftOut: 0, moved: { markets: 0, credits: true } })?.text).toBe(
      "The credits swap now pays less. Check Details, then confirm.",
    );
  });

  it("names the one market that moved, where it goes now and where it went before", () => {
    const only = { name: "Berlin", to: "400 $M", was: "420 $M" };
    expect(statusLine({ steps: idle, leftOut: 0, moved: { markets: 1, credits: false, only } })?.text).toBe(
      "Berlin now goes to 400 $M, not 420 $M. Confirm to go on.",
    );
    const long = { ...only, name: "A market name far too long to quote" };
    expect(statusLine({ steps: idle, leftOut: 0, moved: { markets: 1, credits: false, only: long } })?.text).toBe(
      "Prices moved on 1 market. Check Details, then confirm.",
    );
  });

  it("puts a notice before the moved pools", () => {
    expect(
      statusLine({
        steps: idle,
        leftOut: 0,
        moved: { markets: 1, credits: false },
        notice: "Switch to Gnosis to predict.",
      })?.text,
    ).toBe("Switch to Gnosis to predict.");
  });

  it("names a large credits swap loss in one short small line before a run, and not once one has started", () => {
    expect(statusLine({ steps: idle, leftOut: 0, creditsLoss: "≈ 38 xDAI" })).toEqual({
      text: "Credits swap loses ≈ 38 xDAI.",
      tone: "warning",
      small: true,
    });
    const started = steps({ progress: progress({ stage: "signing" }) });
    expect(statusLine({ steps: started, leftOut: 0, creditsLoss: "≈ 38 xDAI" })).toBeNull();
  });

  it("says in a few words that a sent transaction is not confirmed yet", () => {
    const pending = steps({
      progress: progress({
        stage: "halted",
        failure: { reason: "rpc", retryable: true },
        pendingHash: `0x${"ab".repeat(32)}`,
      }),
    });

    expect(statusLine({ steps: pending, leftOut: 0 })).toEqual({
      text: "Sent, not confirmed yet.",
      tone: "warning",
    });
  });

  it.each([
    ["rejected", "You declined in your wallet."],
    ["cancelled", "Cancelled or replaced in your wallet."],
    ["reverted", "The trade failed at these prices. Raise slippage in Settings and retry."],
    ["rpc", "The network did not answer."],
    ["unknown", "Something went wrong."],
    ["no-route", "No trade found for these estimates. Try a larger amount."],
    ["quote", "Could not get prices. Try again shortly."],
    ["funds", "Your wallet is short, fee included. Lower the amount or add funds."],
    ["balance", "Trade wallet balance is lower than shown. Check the amount."],
    ["deposit-unconfirmed", "Your last transaction may still be confirming. Check your wallet."],
    ["wrong-wallet", "Started from another wallet. Connect it to finish."],
    ["wrong-chain", "Started on another network. Switch to it to finish."],
  ] as const)("names a %s stop in words with a referent", (reason, text) => {
    const stopped = steps({ progress: progress({ stage: "halted", failure: { reason, retryable: true } }) });

    expect(statusLine({ steps: stopped, leftOut: 0 })?.text).toBe(text);
  });

  it("names a funds stop after money moved as the fee alone", () => {
    const stopped = steps({
      progress: progress({ stage: "halted", failure: { reason: "funds", retryable: true }, moneyMoved: true }),
    });

    expect(statusLine({ steps: stopped, leftOut: 0 })?.text).toBe(
      "Not enough xDAI for the fee. Add some, then try the rest.",
    );
  });

  it("says nothing while a step is running", () => {
    expect(statusLine({ steps: steps({ progress: progress() }), leftOut: 0 })).toBeNull();
  });

  it("puts what the visitor has to do ahead of why the run stopped", () => {
    expect(statusLine({ steps: halted, notice: "Switch your wallet to Gnosis.", leftOut: 0 })).toEqual({
      text: "Switch your wallet to Gnosis.",
      tone: "warning",
    });
  });

  it("puts what the visitor has to do ahead of a transaction still out", () => {
    const pending = steps({
      progress: progress({
        stage: "halted",
        failure: { reason: "rpc", retryable: true },
        pendingHash: `0x${"ab".repeat(32)}`,
      }),
    });

    expect(
      statusLine({
        steps: pending,
        notice: "Connect a wallet to predict.",
        leftOut: 0,
      }),
    ).toEqual({ text: "Connect a wallet to predict.", tone: "warning" });
  });

  it("warns, rather than errs, about a transaction sent but not yet confirmed", () => {
    const pending = steps({
      progress: progress({
        stage: "halted",
        failure: { reason: "rpc", retryable: true },
        pendingHash: `0x${"ab".repeat(32)}`,
      }),
    });

    expect(statusLine({ steps: pending, leftOut: 0 })?.tone).toBe("warning");
  });

  it("says nothing between steps of a run that is going normally", () => {
    const between = steps({
      progress: progress({
        stage: "confirming",
        steps: progress().steps.map((step) => ({ ...step, state: "success" as const })),
      }),
    });

    expect(statusLine({ steps: between, leftOut: 0 })).toBeNull();
  });

  it("says why a run stopped when nothing else is asked of the visitor", () => {
    expect(statusLine({ steps: halted, leftOut: 0 })?.tone).toBe("error");
  });
});

describe("predictSteps with credits moved to the trade wallet", () => {
  const withCredits = [
    { id: "create-wallet", label: "Set up your trade wallet", state: "success" as const },
    { id: "add-credits", label: "Add credits to your trade wallet", state: "pending" as const },
    { id: "deposit", label: "Add money to your trade wallet", state: "pending" as const },
    { id: "predict-1", label: "Making your prediction", state: "pending" as const },
  ];

  it("names the credits and the money the funds step adds", () => {
    expect(steps({ credits: (3n * WAD) / 2n }).rows[1]).toEqual({
      key: "funds",
      title: "Add funds",
      subtitle: "1.5 credits + 4 sDAI",
      view: "idle",
    });
  });

  it("names the credits alone when no money is added", () => {
    expect(steps({ toAdd: 0n, credits: 2n * WAD }).rows[1]).toMatchObject({ subtitle: "2 credits", view: "idle" });
  });

  it("runs the funds row while the credits move, and finishes it only once the money is in too", () => {
    const moving = steps({
      credits: WAD,
      progress: progress({
        stage: "signing",
        steps: withCredits.map((step) => (step.id === "add-credits" ? { ...step, state: "running" as const } : step)),
      }),
    });
    expect(moving.rows[1]).toMatchObject({ view: "running", subtitle: "Confirm in your wallet" });

    const halfway = steps({
      credits: WAD,
      progress: progress({
        stage: "quoting",
        steps: withCredits.map((step) => (step.id === "add-credits" ? { ...step, state: "success" as const } : step)),
      }),
    });
    expect(halfway.rows[1]!.view).not.toBe("done");
  });

  it("marks the funds row failed when moving the credits stops the run", () => {
    const stopped = steps({
      credits: WAD,
      progress: progress({
        stage: "halted",
        failure: { reason: "rejected", retryable: true },
        steps: withCredits.map((step) => (step.id === "add-credits" ? { ...step, state: "error" as const } : step)),
      }),
    });

    expect(stopped.rows.map((row) => row.view)).toEqual(["done", "failed", "inactive"]);
  });

  it("says credits cannot be spent right now when the manager cannot cover them", () => {
    const stopped = steps({
      progress: progress({ stage: "halted", failure: { reason: "credits", retryable: false } }),
    });

    expect(stopped.failure).toBe("Credits can't be spent right now. Untick them to predict with your own funds.");
  });

  it("freezes the credits a run moves along with the money it adds", () => {
    const funding = planFunding({
      amount: 5n * WAD,
      ownWallet: 10n * WAD,
      tradeWallet: 0n,
      credits: [{ kind: "foresight", tradeWallet: 0n, wallet: 2n * WAD, usable: 2n * WAD }],
    });

    expect(
      fundsToAdd(funding, { id: "collateral", symbol: "sDAI", decimals: 18 }, { symbol: "sDAI", decimals: 18 }),
    ).toEqual({ toAdd: 3n * WAD, credits: 2n * WAD, symbol: "sDAI", decimals: 18 });
  });
});
