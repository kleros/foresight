import { createFlowRunStore, createMemoryStorage, type FlowTx, type TxGateway } from "@foresight/tx-orchestrator";
import type { Hash, TransactionReceipt } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import { addresses, ctx, fakeQuoter, fakeReader, snapshot, WAD } from "../../flow/__tests__/support/fakes";
import { STEP_ID } from "../../flow/plan";
import type { PredictCtx, PredictSnapshot } from "../../flow/types";
import { predictSteps, statusLine } from "../../utils/predictSteps";
import { createPredictRun } from "../driver";
import type { PredictDriver, PredictProgress } from "../types";

const FLOW_ID = "predict-pending-hash";

/** Signs everything; the first receipt wait fails with an error the run cannot classify, later ones mine. */
function flakyWaitGateway(): TxGateway & { signRequests: FlowTx[] } {
  const signRequests: FlowTx[] = [];
  let failedOnce = false;
  const receipt = (hash: Hash) =>
    ({ transactionHash: hash, status: "success", blockNumber: 19_000_000n }) as TransactionReceipt;
  return {
    signRequests,
    sendTransaction: (tx) => {
      signRequests.push(tx);
      return Promise.resolve(`0x${signRequests.length.toString(16).padStart(64, "0")}` as Hash);
    },
    waitForReceipt: ({ hash }) => {
      if (failedOnce) return Promise.resolve(receipt(hash));
      failedOnce = true;
      return Promise.reject(new Error("node said something odd", { cause: "opaque" }));
    },
    getReceipt: (hash) => Promise.resolve(receipt(hash)),
    isKnown: () => Promise.resolve(true),
  };
}

const isDeposit = (tx: FlowTx) => tx.to === addresses.collateral || tx.to === addresses.sDaiAdapter;

const message = (progress: PredictProgress) =>
  predictSteps({ wallet: null, toAdd: 0n, symbol: "sDAI", decimals: 18, progress }).failure;

let driver: PredictDriver | undefined;
afterEach(() => driver?.dispose());

describe("createPredictRun when a receipt wait fails with an unclassified error", () => {
  it("keeps the deposit's hash, offers to check again, and waits on it rather than signing again", async () => {
    const gateway = flakyWaitGateway();
    const store = createFlowRunStore({ storage: createMemoryStorage() });
    let collateral = WAD * 2n;
    const reader = { ...fakeReader({ deployed: true }), collateralBalance: async () => collateral };
    driver = createPredictRun({
      gateway,
      reader,
      quoter: fakeQuoter(),
      store,
      flowId: FLOW_ID,
      ctx: () => ctx(),
      snapshot: () => snapshot({ deposit: WAD * 3n, collateralIn: WAD * 5n, collateralBefore: WAD * 2n }),
    });

    driver.start();
    await vi.waitFor(() => expect(driver!.getProgress().stage).toBe("halted"));

    const hash = `0x${"1".padStart(64, "0")}` as Hash;
    const halted = driver.getProgress();
    expect(halted.failure).toEqual({ reason: "unknown", retryable: true });
    expect(halted.pendingHash).toBe(hash);
    expect(message(halted)).not.toBe(message({ ...halted, pendingHash: undefined }));
    expect(
      store.load<PredictSnapshot, PredictCtx>(FLOW_ID)?.steps.find((step) => step.stepId === STEP_ID.deposit)?.outcome,
    ).toEqual({ status: "submitted", hash });

    collateral += WAD * 3n;
    driver.retry();
    await vi.waitFor(() => expect(driver!.getProgress().stage).toBe("complete"));

    expect(gateway.signRequests.filter(isDeposit)).toHaveLength(1);
    expect(driver.getProgress().pendingHash).toBeUndefined();
  });
});

describe("createPredictRun while it checks a sent transaction again", () => {
  it("says it is checking that transaction, on the row that sent it, and not the line shown before a run", async () => {
    const gateway = flakyWaitGateway();
    let answer: () => void = () => undefined;
    const answered = new Promise<void>((resolve) => (answer = resolve));
    const getReceipt = gateway.getReceipt;
    gateway.getReceipt = async (hash) => {
      await answered;
      return getReceipt(hash);
    };
    let collateral = WAD * 2n;
    const reader = { ...fakeReader({ deployed: true }), collateralBalance: async () => collateral };
    driver = createPredictRun({
      gateway,
      reader,
      quoter: fakeQuoter(),
      store: createFlowRunStore({ storage: createMemoryStorage() }),
      flowId: `${FLOW_ID}-checking`,
      ctx: () => ctx(),
      snapshot: () => snapshot({ deposit: WAD * 3n, collateralIn: WAD * 5n, collateralBefore: WAD * 2n }),
    });

    driver.start();
    await vi.waitFor(() => expect(driver!.getProgress().stage).toBe("halted"));
    collateral += WAD * 3n;
    driver.retry();
    await vi.waitFor(() => expect(driver!.getProgress().stage).toBe("confirming"));

    const steps = predictSteps({
      wallet: null,
      toAdd: WAD * 3n,
      symbol: "sDAI",
      decimals: 18,
      progress: driver.getProgress(),
    });
    expect(steps.rows.find((row) => row.key === "funds")?.view).toBe("running");
    expect(statusLine({ steps, skipped: 0 })).toEqual({
      text: "Checking your last transaction…",
      tone: "neutral",
    });

    answer();
    await vi.waitFor(() => expect(driver!.getProgress().stage).toBe("complete"));
  });
});
