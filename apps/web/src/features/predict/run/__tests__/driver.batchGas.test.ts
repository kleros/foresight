import { createFlowRunStore, createMemoryStorage, type TxGateway } from "@foresight/tx-orchestrator";
import { UserRejectedRequestError } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
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

const FLOW_ID = "predict-batch-gas";
const OPTIONS = [1, 2, 3, 4, 5].map((index) => option(index));

const drivers: PredictDriver[] = [];
afterEach(() => {
  for (const driver of drivers.splice(0)) driver.dispose();
});

/** Turns down every send, so a run stops at its first one with its plan saved. */
const rejecting: TxGateway = {
  sendTransaction: () => Promise.reject(new UserRejectedRequestError(new Error("rejected"))),
  waitForReceipt: () => Promise.reject(new Error("nothing was sent")),
  getReceipt: () => Promise.resolve(null),
  isKnown: () => Promise.resolve(false),
};

function setup(blockGasLimit: bigint, store = createFlowRunStore({ storage: createMemoryStorage() })) {
  const driver = createPredictRun({
    gateway: rejecting,
    reader: fakeReader({ deployed: true, state: () => chainState({ underlying: WAD }), blockGasLimit }),
    quoter: fakeQuoter(),
    flowId: FLOW_ID,
    store,
    ctx: () => ctx(),
    snapshot: () => snapshot({ options: OPTIONS }),
  });
  drivers.push(driver);
  return { driver, store };
}

const batchRows = (driver: PredictDriver) =>
  driver.getProgress().steps.filter((row) => row.id.startsWith("predict-")).length;

describe("createPredictRun's batches", () => {
  it("holds as many options each as the latest block's gas limit leaves room for", async () => {
    const { driver } = setup(gasLimitFor(2));

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("halted"));

    expect(batchRows(driver)).toBe(3);
    expect(driver.getProgress().batches).toBe(3);
  });

  it("keeps a stored run's batches when the gas limit has changed since it started", async () => {
    const { driver, store } = setup(gasLimitFor(2));
    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("halted"));
    driver.dispose();

    const reopened = setup(gasLimitFor(1), store).driver;
    reopened.recover();
    await vi.waitFor(() => expect(reopened.getProgress().stage).toBe("review"));

    expect(reopened.getProgress().recovered?.optionsPerBatch).toBe(2);
    expect(batchRows(reopened)).toBe(3);
  });

  it("stops before planning when the gas limit cannot be read, and tries again on retry", async () => {
    let fails = true;
    const reader = fakeReader({ deployed: true, state: () => chainState({ underlying: WAD }) });
    const driver = createPredictRun({
      gateway: rejecting,
      reader: {
        ...reader,
        blockGasLimit: () => (fails ? Promise.reject(new Error("node down")) : reader.blockGasLimit()),
      },
      quoter: fakeQuoter(),
      flowId: `${FLOW_ID}-unread`,
      ctx: () => ctx(),
      snapshot: () => snapshot({ options: OPTIONS }),
    });
    drivers.push(driver);

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("halted"));
    expect(driver.getProgress().failure?.retryable).toBe(true);
    expect(driver.getProgress().steps).toEqual([]);

    fails = false;
    driver.retry();
    await vi.waitFor(() => expect(driver.getProgress().failure?.reason).toBe("rejected"));
    expect(batchRows(driver)).toBeGreaterThan(0);
  });
});
