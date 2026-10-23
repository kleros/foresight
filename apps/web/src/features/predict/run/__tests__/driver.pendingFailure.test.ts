import { createFlowRunStore, createMemoryStorage, type TxGateway } from "@foresight/tx-orchestrator";
import type { Hash, TransactionReceipt } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import { addresses, ctx, fakeQuoter, fakeReader, snapshot } from "../../flow/__tests__/support/fakes";
import { STEP_ID } from "../../flow/plan";
import type { PredictCtx, PredictReader, PredictSnapshot } from "../../flow/types";
import { createPredictRun } from "../driver";
import { predictFlowId } from "../interrupted";
import type { PredictDriver } from "../types";

const FLOW_ID = predictFlowId("session-1", addresses.owner);

const gateway: TxGateway = {
  sendTransaction: () => Promise.resolve(`0x${"1".padStart(64, "0")}` as Hash),
  waitForReceipt: ({ hash }) =>
    Promise.resolve({
      transactionHash: hash,
      status: "success",
      blockNumber: 2n,
      logs: [],
    } as unknown as TransactionReceipt),
  getReceipt: () => Promise.resolve(null),
  isKnown: () => Promise.resolve(false),
};

const drivers: PredictDriver[] = [];
afterEach(() => {
  for (const driver of drivers.splice(0)) driver.dispose();
});

function driverOn(reader: PredictReader, store = createFlowRunStore({ storage: createMemoryStorage() })) {
  const driver = createPredictRun({
    gateway,
    reader,
    quoter: fakeQuoter(),
    flowId: FLOW_ID,
    ctx: () => ctx(),
    snapshot: () => snapshot(),
    store,
  });
  drivers.push(driver);
  return { driver, store };
}

describe("createPredictRun stopped because its own transaction may still be confirming", () => {
  it("keeps a new run halted at a pending transaction through reset", async () => {
    const { driver, store } = driverOn(fakeReader({ deployed: true, pending: () => true }));

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().failure?.reason).toBe("pending"));
    driver.reset();

    expect(store.load(FLOW_ID)).not.toBeNull();
  });

  it("keeps a recovered run whose deposit may have been signed with no hash kept through reset", async () => {
    const store = createFlowRunStore({ storage: createMemoryStorage() });
    store.save<PredictSnapshot, PredictCtx>({
      flowId: FLOW_ID,
      adapterId: "predict-flow",
      status: "running",
      ctx: ctx(),
      snapshot: snapshot(),
      steps: [
        { stepId: STEP_ID.createExecutor, label: "Set up your trade wallet", outcome: { status: "skipped" } },
        { stepId: STEP_ID.deposit, label: "Add money", outcome: { status: "awaiting-signature" } },
        { stepId: STEP_ID.predict(1), label: "Making your prediction", outcome: { status: "pending" } },
      ],
    });
    const { driver } = driverOn(fakeReader({ deployed: true }), store);

    driver.recover();
    await vi.waitFor(() => expect(driver.getProgress().failure?.reason).toBe("deposit-unconfirmed"));
    driver.reset();

    expect(store.load(FLOW_ID)).not.toBeNull();
  });
});
