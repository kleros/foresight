import { describe, expect, it } from "vitest";

import type { PredictProgress } from "../../run/types";
import { planFunding } from "../funding";
import { fundsToAdd, predictSteps } from "../predictSteps";

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
      { key: "funds", title: "Add funds to your trade wallet", subtitle: "Adding 4 sDAI", view: "idle" },
      { key: "predict", title: "Make prediction", subtitle: "", view: "idle" },
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
    expect(steps({ toAdd: 15n * 10n ** 10n }).rows[1]?.subtitle).toBe("Adding less than 0.0001 sDAI");
    // a single wei still reads as something being added
    expect(steps({ toAdd: 1n }).rows[1]?.subtitle).toBe("Adding less than 0.0001 sDAI");
  });
});

describe("predictSteps naming what the funds step adds", () => {
  const SDAI = { id: "collateral", symbol: "sDAI", decimals: 18 } as const;
  const XDAI = { id: "native", symbol: "xDAI", decimals: 18 } as const;
  // the deposit for 900 xDAI at this rate rounds to 1 wei short of 900; the sDAI is 717.546564785684787149
  const XDAI_PER_SDAI = 1_254273999999999999n;

  it("names an sDAI payment in sDAI alone", () => {
    const funding = planFunding({ amount: 10n * WAD, ownWallet: 25n * WAD, tradeWallet: 0n });

    expect(steps(fundsToAdd(funding, SDAI, SDAI)).rows[1]?.subtitle).toBe("Adding 10 sDAI");
  });

  it("names an xDAI payment in xDAI, with the sDAI it becomes", () => {
    const funding = planFunding({
      amount: 900n * WAD,
      ownWallet: 1000n * WAD,
      tradeWallet: 0n,
      tokenPerCollateralWad: XDAI_PER_SDAI,
    });

    expect(steps(fundsToAdd(funding, XDAI, SDAI)).rows[1]?.subtitle).toBe("Adding 900 xDAI (~717.5466 sDAI)");
  });

  it("names only the xDAI the trade wallet does not already cover", () => {
    const funding = planFunding({
      amount: 900n * WAD,
      ownWallet: 1000n * WAD,
      tradeWallet: 100n * WAD,
      tokenPerCollateralWad: 1_250000000000000000n,
    });

    expect(steps(fundsToAdd(funding, XDAI, SDAI)).rows[1]?.subtitle).toBe("Adding 775 xDAI (~620 sDAI)");
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

    expect(rows[2]).toMatchObject({ view: "running", subtitle: "Finding the best prices…" });
  });

  it("says what the running prediction is waiting on", () => {
    const rows = steps({ progress: progress({ stage: "signing" }) }).rows;

    expect(rows.map((row) => row.view)).toEqual(["done", "done", "running"]);
    expect(rows[2]?.subtitle).toBe("Waiting for your signature…");
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

    expect(rows[2]?.subtitle).toBe("Prediction 2 of 2. Confirming…");
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

    expect(rows[2]).toMatchObject({ view: "done", subtitle: "Prediction successful!" });
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

    expect(result.failure).toBe("You turned the request down.");
    expect(result.rows[2]).toMatchObject({ view: "failed", subtitle: "3 of 5 predictions went through" });
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
    ["signing", "Waiting for your signature…"],
    ["confirming", "Confirming…"],
  ] as const)("shows Add funds running and says what it waits on while %s", (stage, copy) => {
    const funds = steps({ progress: depositing(stage) }).rows[1];

    expect(funds?.view).toBe("running");
    expect(funds?.subtitle).toContain(copy);
  });

  it("stops asking for a signature once the deposit's hash is known", () => {
    const signed = steps({ progress: depositing("signing") }).rows[1];
    const sent = steps({ progress: depositing("confirming") }).rows[1];

    expect(signed?.subtitle).not.toBe(sent?.subtitle);
    expect(sent?.subtitle).not.toContain("Waiting for your signature…");
  });
});
