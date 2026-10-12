import { createFlowRunStore, createMemoryStorage, type FlowTx, type TxGateway } from "@foresight/tx-orchestrator";
import { decodeFunctionData, erc20Abi, type Hash, type Hex, type TransactionReceipt } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import { addresses, ctx, fakeQuoter, fakeReader, snapshot, WAD } from "../../flow/__tests__/support/fakes";
import { STEP_ID } from "../../flow/plan";
import type { PredictCtx, PredictSnapshot } from "../../flow/types";
import { createPredictRun } from "../driver";
import type { PredictDriver } from "../types";

const FLOW_ID = "predict-review";
const SAVED = snapshot({ deposit: WAD * 3n, collateralIn: WAD * 3n, collateralBefore: 0n, collateralAtStart: 0n });
const CURRENT = snapshot({ deposit: WAD, collateralIn: WAD, collateralBefore: 0n });

function fakeGateway(): TxGateway & { readonly signRequests: FlowTx[] } {
  const signRequests: FlowTx[] = [];
  const receipt = (hash: Hash): TransactionReceipt =>
    ({ transactionHash: hash, status: "success", blockNumber: 19_000_000n }) as TransactionReceipt;
  return {
    signRequests,
    sendTransaction: (tx) => {
      signRequests.push(tx);
      return Promise.resolve(`0x${signRequests.length.toString(16).padStart(64, "0")}` as Hash);
    },
    waitForReceipt: ({ hash }) => Promise.resolve(receipt(hash)),
    getReceipt: () => Promise.resolve(null),
    isKnown: () => Promise.resolve(false),
  };
}

/** A run whose deposit the visitor turned down before the tab closed, or one already broadcast. */
function storedRejectedDeposit(
  deposit: { status: "pending" } | { status: "submitted"; hash: Hash } = { status: "pending" },
) {
  const store = createFlowRunStore({ storage: createMemoryStorage() });
  store.save<PredictSnapshot, PredictCtx>({
    flowId: FLOW_ID,
    adapterId: "predict-flow",
    status: "paused",
    reason: "error",
    error: { stepId: STEP_ID.deposit, message: "rejected", cause: "rejected" },
    ctx: ctx(),
    snapshot: SAVED,
    steps: [
      { stepId: STEP_ID.createExecutor, label: "Set up your trade wallet", outcome: { status: "skipped" } },
      { stepId: STEP_ID.deposit, label: "Add money to your trade wallet", outcome: deposit },
      { stepId: STEP_ID.predict(1), label: "Making your prediction", outcome: { status: "pending" } },
    ],
  });
  return store;
}

const drivers: PredictDriver[] = [];
afterEach(() => {
  for (const driver of drivers.splice(0)) driver.dispose();
});

function setup(opts: { store?: ReturnType<typeof storedRejectedDeposit>; gateway?: TxGateway } = {}) {
  const store = opts.store ?? storedRejectedDeposit();
  const gateway = { ...fakeGateway(), ...opts.gateway };
  const driver = createPredictRun({
    gateway,
    reader: fakeReader({ deployed: true, collateral: 0n }),
    quoter: fakeQuoter(),
    flowId: FLOW_ID,
    store,
    ctx: () => ctx(),
    snapshot: () => CURRENT,
  });
  drivers.push(driver);
  return { driver, gateway, store };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const transferred = (tx: FlowTx) => decodeFunctionData({ abi: erc20Abi, data: tx.data as Hex }).args[1];

describe("createPredictRun with a stored run", () => {
  it.each([
    ["recover", (driver: PredictDriver) => driver.recover()],
    ["start", (driver: PredictDriver) => driver.start()],
  ])("holds it for review on %s, showing its own snapshot and signing nothing", async (_, open) => {
    const { driver, gateway } = setup();

    open(driver);
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("review"));
    await settle();

    expect(driver.getProgress().recovered).toEqual(SAVED);
    expect(gateway.signRequests).toEqual([]);
  });

  it("ignores start and retry while under review", async () => {
    const { driver, gateway } = setup();
    driver.recover();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("review"));

    driver.start();
    driver.retry();
    await settle();

    expect(driver.getProgress().stage).toBe("review");
    expect(gateway.signRequests).toEqual([]);
  });

  it("signs the stored deposit, not the form's, once resumed", async () => {
    const { driver, gateway } = setup();
    driver.recover();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("review"));

    driver.resume();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("complete"));

    const deposits = gateway.signRequests.filter((tx) => tx.to === addresses.collateral);
    expect(deposits.map(transferred)).toEqual([SAVED.deposit]);
  });

  it("does nothing on resume when no run is under review", async () => {
    const { driver, gateway } = setup();

    driver.resume();
    await settle();

    expect(driver.getProgress().stage).toBe("idle");
    expect(gateway.signRequests).toEqual([]);
  });

  it("forgets the stored snapshot once the run is thrown away, and a fresh run shows none", async () => {
    const { driver, store } = setup();
    driver.recover();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("review"));

    driver.reset();

    expect(driver.getProgress().recovered).toBeUndefined();
    expect(store.load(FLOW_ID)).toBeNull();

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("complete"));
    expect(driver.getProgress().recovered).toBeUndefined();
  });

  it("checks the chain again on resume, and stops on a deposit dropped during the review", async () => {
    const hash = `0x${"d".repeat(64)}` as Hash;
    let known = true;
    const gateway: TxGateway = {
      ...fakeGateway(),
      isKnown: () => Promise.resolve(known),
      waitForReceipt: () => new Promise(() => {}),
    };
    const { driver } = setup({ store: storedRejectedDeposit({ status: "submitted", hash }), gateway });
    driver.recover();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("review"));
    expect(driver.getProgress().pendingHash).toBe(hash);

    known = false;
    driver.resume();

    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("halted"));
    expect(driver.getProgress().failure?.retryable).toBe(true);
    expect(driver.getProgress().pendingHash).toBeUndefined();
  });
});
