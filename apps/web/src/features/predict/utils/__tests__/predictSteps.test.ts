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
  skipped: [],
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

  it("names an xDAI payment in xDAI, with the sDAI it becomes", () => {
    const funding = planFunding({
      amount: 900n * WAD,
      ownWallet: 1000n * WAD,
      tradeWallet: 0n,
      tokenPerCollateralWad: XDAI_PER_SDAI,
    });

    expect(steps(fundsToAdd(funding, XDAI, SDAI)).rows[1]?.subtitle).toBe("900 xDAI (≈ 717.5466 sDAI)");
  });

  it("names only the xDAI the trade wallet does not already cover", () => {
    const funding = planFunding({
      amount: 900n * WAD,
      ownWallet: 1000n * WAD,
      tradeWallet: 100n * WAD,
      tokenPerCollateralWad: 1_250000000000000000n,
    });

    expect(steps(fundsToAdd(funding, XDAI, SDAI)).rows[1]?.subtitle).toBe("775 xDAI (≈ 620 sDAI)");
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
  it("shows the prices being checked before the run has a step going", () => {
    const pending = progress().steps.map((step) => ({ ...step, state: "pending" as const }));
    const rows = steps({ progress: progress({ stage: "quoting", steps: pending }) }).rows;

    expect(rows[2]).toMatchObject({ view: "running", subtitle: "Finding prices…" });
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
  it("reads the same in the summary under the amount and in the funds step", () => {
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
    expect(subtitle).toBe("1 xDAI (≈ 0.7973 sDAI)");
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

    expect(statusLine({ steps: idle, skipped: 0 })).toBeNull();
    expect(placed.rows.find((row) => row.key === "predict")?.view).toBe("done");
    expect(statusLine({ steps: placed, skipped: 0 })).toBeNull();
  });

  it("names the estimates a run left out, since they were not signed", () => {
    expect(statusLine({ steps: idle, skipped: 2 })).toEqual({
      text: "2 estimates could not be traded and were left out.",
      tone: "neutral",
    });
    expect(statusLine({ steps: idle, skipped: 1 })?.text).toBe("1 estimate could not be traded and was left out.");
  });

  it("says in a few words that a sent transaction is not confirmed yet", () => {
    const pending = steps({
      progress: progress({
        stage: "halted",
        failure: { reason: "rpc", retryable: true },
        pendingHash: `0x${"ab".repeat(32)}`,
      }),
    });

    expect(statusLine({ steps: pending, skipped: 0 })).toEqual({
      text: "Sent, not confirmed yet.",
      tone: "warning",
    });
  });

  it.each([
    ["cancelled", "Your wallet cancelled or replaced the request."],
    ["funds", "Not enough in your wallet for this and the network fee. Lower the amount or add funds."],
  ] as const)("names a %s stop in words with a referent", (reason, text) => {
    const stopped = steps({ progress: progress({ stage: "halted", failure: { reason, retryable: true } }) });

    expect(statusLine({ steps: stopped, skipped: 0 })?.text).toBe(text);
  });

  it("says nothing while a step is running", () => {
    expect(statusLine({ steps: steps({ progress: progress() }), skipped: 0 })).toBeNull();
  });

  it("puts what the visitor has to do ahead of why the run stopped", () => {
    expect(statusLine({ steps: halted, notice: "Switch your wallet to Gnosis.", skipped: 0 })).toEqual({
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
        skipped: 0,
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

    expect(statusLine({ steps: pending, skipped: 0 })?.tone).toBe("warning");
  });

  it("says nothing between steps of a run that is going normally", () => {
    const between = steps({
      progress: progress({
        stage: "confirming",
        steps: progress().steps.map((step) => ({ ...step, state: "success" as const })),
      }),
    });

    expect(statusLine({ steps: between, skipped: 0 })).toBeNull();
  });

  it("says why a run stopped when nothing else is asked of the visitor", () => {
    expect(statusLine({ steps: halted, skipped: 0 })?.tone).toBe("error");
  });
});
