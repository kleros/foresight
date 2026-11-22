import { createFlowRunStore, createMemoryStorage, type FlowTx, type TxGateway } from "@foresight/tx-orchestrator";
import type { Hash, TransactionReceipt } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import { addresses, ctx, fakeQuoter, fakeReader, snapshot } from "../../flow/__tests__/support/fakes";
import { createPredictRun } from "../driver";
import { hasPendingTransaction, predictFlowId } from "../interrupted";
import type { PredictDriver } from "../types";

const SESSION = "session-1";
const FLOW_ID = predictFlowId(SESSION, addresses.owner);

/** A chain that mines each send at once. */
function chain() {
  const sends: FlowTx[] = [];
  const receipt = (hash: Hash) =>
    ({ transactionHash: hash, status: "success", blockNumber: 2n, logs: [] }) as unknown as TransactionReceipt;
  const gateway: TxGateway = {
    sendTransaction: (tx) => {
      sends.push(tx);
      return Promise.resolve(`0x${sends.length.toString(16).padStart(64, "0")}` as Hash);
    },
    waitForReceipt: ({ hash }) => Promise.resolve(receipt(hash)),
    getReceipt: (hash) => Promise.resolve(receipt(hash)),
    isKnown: () => Promise.resolve(true),
  };
  return { gateway, sends };
}

const drivers: PredictDriver[] = [];
afterEach(() => {
  for (const driver of drivers.splice(0)) driver.dispose();
});

function run(maySend: () => Promise<boolean>) {
  const fake = chain();
  const store = createFlowRunStore({ storage: createMemoryStorage() });
  const driver = createPredictRun({
    gateway: fake.gateway,
    reader: fakeReader({ deployed: true }),
    quoter: fakeQuoter(),
    flowId: FLOW_ID,
    ctx: () => ctx(),
    snapshot: () => snapshot(),
    store,
    maySend,
  });
  drivers.push(driver);
  return { driver, fake, store };
}

describe("createPredictRun asks maySend before each send", () => {
  it("sends nothing and stops at blocked when refused before the first send", async () => {
    const { driver, fake, store } = run(() => Promise.resolve(false));

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("halted"));

    expect(fake.sends).toEqual([]);
    expect(driver.getProgress().failure).toEqual({ reason: "blocked", retryable: true });
    expect(driver.getProgress().moneyMoved).toBeUndefined();
    expect(driver.getProgress().unanswered).toBeUndefined();
    expect(hasPendingTransaction(store, SESSION, addresses.owner)).toBe(false);
  });

  it("stops between sends once refused, keeping the sends already made", async () => {
    let allowed = 1;
    const maySend = vi.fn(() => Promise.resolve(allowed-- > 0));
    const { driver, fake } = run(maySend);

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("halted"));

    expect(fake.sends).toHaveLength(1);
    expect(maySend).toHaveBeenCalledTimes(2);
    expect(driver.getProgress().failure?.reason).toBe("blocked");
  });

  it("goes on with the next send once allowed again", async () => {
    let allowed = false;
    const { driver, fake } = run(() => Promise.resolve(allowed));

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("halted"));
    allowed = true;
    driver.retry();

    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("complete"));
    expect(fake.sends.length).toBeGreaterThan(0);
  });
});
