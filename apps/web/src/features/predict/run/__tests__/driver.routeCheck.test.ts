import type { FlowTx, TxGateway } from "@foresight/tx-orchestrator";
import type { Hash, TransactionReceipt } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import { addresses, ctx, fakeQuoter, fakeReader, snapshot } from "../../flow/__tests__/support/fakes";
import type { FakeQuoter } from "../../flow/__tests__/support/fakes";
import { createPredictRun } from "../driver";
import type { PredictDriver } from "../types";

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
    getReceipt: (hash) => Promise.resolve(receipt(hash)),
    isKnown: () => Promise.resolve(true),
  };
}

const isDeposit = (tx: FlowTx) => tx.to === addresses.collateral;

const drivers: PredictDriver[] = [];
afterEach(() => {
  for (const driver of drivers.splice(0)) driver.dispose();
});

function setup(quoter: FakeQuoter) {
  const gateway = fakeGateway();
  const driver = createPredictRun({
    gateway,
    reader: fakeReader({ deployed: true }),
    quoter,
    flowId: `predict-route-check-${drivers.length}`,
    ctx: () => ctx(),
    snapshot: () => snapshot(),
  });
  drivers.push(driver);
  return { gateway, driver };
}

const settled = (driver: PredictDriver) =>
  vi.waitFor(() => expect(["halted", "complete"]).toContain(driver.getProgress().stage));

describe("createPredictRun route check", () => {
  it("lets a run that routes go through, depositing once", async () => {
    const { gateway, driver } = setup(fakeQuoter());

    driver.start();
    await settled(driver);

    expect(driver.getProgress().stage).toBe("complete");
    expect(gateway.signRequests.filter(isDeposit)).toHaveLength(1);
  });

  it("starts once when pressed again while the routes are checked", async () => {
    const quoter = fakeQuoter();
    const { gateway, driver } = setup(quoter);

    driver.start();
    expect(driver.getProgress().stage).toBe("quoting");
    driver.start();
    await settled(driver);

    expect(driver.getProgress()).toMatchObject({ stage: "complete", failure: undefined });
    expect(gateway.signRequests.filter(isDeposit)).toHaveLength(1);
    // one sell and one buy, quoted by the check and again by the build
    expect(quoter.requests).toHaveLength(4);
  });

  it.each([
    ["reset", (driver: PredictDriver) => driver.reset()],
    ["disposed", (driver: PredictDriver) => driver.dispose()],
  ])("signs nothing when %s while the routes are checked", async (_, stop) => {
    const quoter = fakeQuoter();
    const { gateway, driver } = setup(quoter);

    driver.start();
    stop(driver);
    await vi.waitFor(() => expect(quoter.requests).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(gateway.signRequests).toEqual([]);
    expect(driver.getProgress()).toMatchObject({ stage: "idle", failure: undefined });
  });

  it("halts as no-route, not retryable, when the route is gone by the time the trade is built", async () => {
    // The default option quotes one sell and one buy; the check spends those two.
    const quoter = fakeQuoter({ refuse: () => quoter.requests.length > 2 });
    const { gateway, driver } = setup(quoter);

    driver.start();
    await settled(driver);

    expect(gateway.signRequests.filter(isDeposit)).toHaveLength(1);
    expect(driver.getProgress().stage).toBe("halted");
    expect(driver.getProgress().failure).toEqual({ reason: "no-route", retryable: false });
  });
});
