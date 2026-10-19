import {
  createFlowRunStore,
  createMemoryStorage,
  type FlowRunStore,
  type FlowTx,
  type TxGateway,
} from "@foresight/tx-orchestrator";
import type { Hash, TransactionReceipt } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addresses,
  chainState,
  ctx,
  fakeQuoter,
  fakeReader,
  gasLimitFor,
  option,
  snapshot,
  WAD,
} from "../../flow/__tests__/support/fakes";
import { createPredictRun } from "../driver";
import type { PredictDriver } from "../types";

/** The third send is the second batch; its receipt waits fail with `waitError` and its lookup says `lookup`. */
function unseenBatchGateway(args: {
  waitError: () => Error;
  lookup: "reverted" | "dropped";
}): TxGateway & { readonly signRequests: FlowTx[] } {
  const signRequests: FlowTx[] = [];
  const unseen = new Set<Hash>();
  const receipt = (hash: Hash, status: "success" | "reverted") =>
    ({ transactionHash: hash, status, blockNumber: 19_000_000n }) as TransactionReceipt;

  return {
    signRequests,
    sendTransaction: (tx) => {
      signRequests.push(tx);
      const hash = `0x${signRequests.length.toString(16).padStart(64, "0")}` as Hash;
      if (signRequests.length === 3) unseen.add(hash);
      return Promise.resolve(hash);
    },
    waitForReceipt: ({ hash }) =>
      unseen.has(hash) ? Promise.reject(args.waitError()) : Promise.resolve(receipt(hash, "success")),
    getReceipt: (hash) => {
      if (!unseen.has(hash)) return Promise.resolve(receipt(hash, "success"));
      return Promise.resolve(args.lookup === "reverted" ? receipt(hash, "reverted") : null);
    },
    isKnown: (hash) => Promise.resolve(!unseen.has(hash) || args.lookup === "reverted"),
  };
}

const isBatch = (tx: FlowTx) => tx.to === addresses.executor;

const drivers: PredictDriver[] = [];
afterEach(() => {
  for (const driver of drivers.splice(0)) driver.dispose();
});

function setup(gateway: TxGateway, store?: FlowRunStore, flowId = `predict-reconcile-${drivers.length}`) {
  const driver = createPredictRun({
    gateway,
    store,
    reader: fakeReader({
      deployed: true,
      collateral: 0n,
      state: () => chainState({ underlying: WAD }),
      blockGasLimit: gasLimitFor(1),
    }),
    quoter: fakeQuoter(),
    flowId,
    ctx: () => ctx(),
    snapshot: () => snapshot({ options: [option(1), option(2)], deposit: WAD, collateralIn: WAD }),
  });
  drivers.push(driver);
  return driver;
}

describe("createPredictRun when a batch's receipt was never seen", () => {
  it("halts for review, without signing, when the unseen batch was dropped, and rebuilds it on the next press", async () => {
    const gateway = unseenBatchGateway({
      waitError: () => new Error("node said something odd", { cause: "opaque" }),
      lookup: "dropped",
    });
    const driver = setup(gateway);

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().pendingHash).toBeDefined());
    expect(driver.getProgress().stage).toBe("halted");

    driver.retry();
    await vi.waitFor(() => expect(driver.getProgress().pendingHash).toBeUndefined());
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(driver.getProgress().stage).toBe("halted");
    expect(driver.getProgress().failure).toEqual({ reason: "unknown", retryable: true });
    expect(gateway.signRequests).toHaveLength(3);

    driver.retry();
    await vi.waitFor(() => expect(gateway.signRequests).toHaveLength(4));
    expect(isBatch(gateway.signRequests[3]!)).toBe(true);
  });

  it(
    "checks the chain before resuming a run the network paused, and offers a rebuild when the batch reverted",
    { timeout: 15_000 },
    async () => {
      const gateway = unseenBatchGateway({ waitError: () => new Error("request timed out"), lookup: "reverted" });
      const driver = setup(gateway);

      driver.start();
      await vi.waitFor(() => expect(driver.getProgress().failure?.reason).toBe("rpc"), { timeout: 10_000 });
      expect(driver.getProgress().pendingHash).toBeDefined();

      driver.retry();
      await vi.waitFor(() => expect(driver.getProgress().failure?.reason).toBe("reverted"));

      expect(driver.getProgress()).toMatchObject({ stage: "halted", failure: { reason: "reverted", retryable: true } });
      expect(driver.getProgress().pendingHash).toBeUndefined();
      expect(gateway.signRequests).toHaveLength(3);
    },
  );
});

describe("createPredictRun when it recovers a run whose batch reverted while the tab was gone", () => {
  it("halts on the revert with a retry on offer, and signs nothing until it is pressed", async () => {
    const store = createFlowRunStore({ storage: createMemoryStorage() });
    const flowId = "predict-reconcile-recovered";
    const left = unseenBatchGateway({ waitError: () => new Error("never"), lookup: "reverted" });
    const other = setup(
      {
        ...left,
        waitForReceipt: (wait) => (left.signRequests.length < 3 ? left.waitForReceipt(wait) : new Promise(() => {})),
      },
      store,
      flowId,
    );
    other.start();
    await vi.waitFor(() => expect(left.signRequests).toHaveLength(3));
    other.dispose();

    const gateway = unseenBatchGateway({ waitError: () => new Error("never"), lookup: "reverted" });
    const recovering = setup({ ...gateway, getReceipt: left.getReceipt }, store, flowId);
    recovering.start();
    await vi.waitFor(() => expect(recovering.getProgress().failure?.reason).toBe("reverted"));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(recovering.getProgress()).toMatchObject({
      stage: "halted",
      failure: { reason: "reverted", retryable: true },
    });
    expect(gateway.signRequests).toEqual([]);
  });
});
