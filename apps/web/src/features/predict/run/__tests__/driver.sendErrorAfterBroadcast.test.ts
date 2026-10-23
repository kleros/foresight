import { createFlowRunStore, createMemoryStorage, type FlowTx, type TxGateway } from "@foresight/tx-orchestrator";
import { UserRejectedRequestError, type Hash, type TransactionReceipt } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import { addresses, ctx, fakeQuoter, fakeReader, snapshot, WAD } from "../../flow/__tests__/support/fakes";
import type { LandedTx, SentTx } from "../../flow/types";
import { createPredictRun } from "../driver";
import { discardRun, hasPendingTransaction, predictFlowId } from "../interrupted";
import type { PredictDriver } from "../types";

const SESSION = "session-1";
const FLOW_ID = predictFlowId(SESSION, addresses.owner);

/** A production wallet's coded error, as an injected wallet surfaces it once its own node has the transaction. */
const internalError = () =>
  new Error("Transaction failed", {
    cause: Object.assign(new Error("Internal JSON-RPC error."), { code: -32603 }),
  });

const isDeposit = (tx: FlowTx) => tx.to === addresses.collateral;

/**
 * A chain that mines the owner's sends in nonce order. A send `broadcastThenFail` picks takes its nonce and stays
 * pending until `land()`, while the wallet call throws `error`. A send `failBeforeBroadcast` picks takes no nonce.
 */
function chain(opts: {
  error: () => Error;
  broadcastThenFail?: (tx: FlowTx) => boolean;
  failBeforeBroadcast?: (tx: FlowTx) => boolean;
}) {
  const byNonce: Array<{ hash: Hash; tx: FlowTx; block?: bigint }> = [];
  const sends: FlowTx[] = [];
  let head = 1n;
  let failed = 0;

  const receipt = (hash: Hash) =>
    ({ transactionHash: hash, status: "success", blockNumber: head, logs: [] }) as unknown as TransactionReceipt;

  const gateway: TxGateway = {
    sendTransaction: (tx) => {
      sends.push(tx);
      if (opts.failBeforeBroadcast?.(tx) && failed++ === 0) return Promise.reject(opts.error());
      const nonce = byNonce.length;
      const hash = `0x${(nonce + 1).toString(16).padStart(64, "0")}` as Hash;
      byNonce.push({ hash, tx });
      if (opts.broadcastThenFail?.(tx) && failed++ === 0) return Promise.reject(opts.error());
      byNonce[nonce]!.block = ++head;
      return Promise.resolve(hash);
    },
    waitForReceipt: ({ hash }) => Promise.resolve(receipt(hash)),
    getReceipt: (hash) => Promise.resolve(receipt(hash)),
    isKnown: () => Promise.resolve(true),
  };

  const sentWithNonce = ({ nonce }: { nonce: number }): Promise<SentTx> => {
    const sent = byNonce[nonce];
    if (!sent) return Promise.resolve({ status: "none" });
    if (sent.block === undefined) return Promise.resolve({ status: "pending" });
    const { to, value = 0n, data = "0x" } = sent.tx;
    return Promise.resolve({ status: "mined", hash: sent.hash, to, value, input: data, success: true });
  };

  const landedSince = ({ fromBlock }: { fromBlock: bigint }): Promise<LandedTx[]> =>
    Promise.resolve(
      byNonce
        .filter((sent) => sent.block !== undefined && sent.block >= fromBlock)
        .map(({ tx }) => ({ to: tx.to, value: tx.value ?? 0n, input: tx.data ?? "0x", collateralReceived: WAD })),
    );

  return {
    gateway,
    deposits: () => sends.filter(isDeposit).length,
    land: () => {
      for (const sent of byNonce) if (sent.block === undefined) sent.block = ++head;
    },
    reader: {
      ...fakeReader({ deployed: true }),
      latestBlock: () => Promise.resolve(head),
      nextNonce: () => Promise.resolve(byNonce.length),
      hasPending: () => Promise.resolve(byNonce.some((sent) => sent.block === undefined)),
      sentWithNonce,
      landedSince,
    },
  };
}

const drivers: PredictDriver[] = [];
afterEach(() => {
  for (const driver of drivers.splice(0)) driver.dispose();
});

function driverOn(fake: ReturnType<typeof chain>, store = createFlowRunStore({ storage: createMemoryStorage() })) {
  const driver = createPredictRun({
    gateway: fake.gateway,
    reader: fake.reader,
    quoter: fakeQuoter(),
    flowId: FLOW_ID,
    ctx: () => ctx(),
    snapshot: () => snapshot(),
    store,
    unansweredSend: { waitMs: 20, pollMs: 5, graceMs: 20 },
  });
  drivers.push(driver);
  return { driver, store };
}

describe("createPredictRun when a send errors after the wallet broadcast it", () => {
  it("keeps the run through reset, so Close and Predict sign the deposit once", async () => {
    const fake = chain({ error: internalError, broadcastThenFail: isDeposit });
    const { driver, store } = driverOn(fake);

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("halted"));
    expect(driver.getProgress().failure?.reason).toBe("pending");
    expect(driver.getProgress().moneyMoved).toBe(true);

    // the popup's Close and Predict both reset a halted run with no hash
    driver.reset();
    expect(store.load(FLOW_ID)).not.toBeNull();
    driver.dispose();

    fake.land();
    const { driver: next } = driverOn(fake, store);
    next.start();
    await vi.waitFor(() => expect(next.getProgress().stage).toBe("review"));
    next.resume();
    await vi.waitFor(() => expect(["halted", "complete"]).toContain(next.getProgress().stage));

    expect(next.getProgress().stage).toBe("complete");
    expect(fake.deposits()).toBe(1);
  });

  it("holds the stored run against the card's Discard while the send is unresolved", async () => {
    const fake = chain({ error: internalError, broadcastThenFail: isDeposit });
    const { driver, store } = driverOn(fake);

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("halted"));
    driver.dispose();

    expect(hasPendingTransaction(store, SESSION, addresses.owner)).toBe(true);
    discardRun(store, SESSION, addresses.owner);
    expect(store.load(FLOW_ID)).not.toBeNull();
  });

  it("still lets a refused send be reset when its nonce was never used", async () => {
    const fake = chain({ error: internalError, failBeforeBroadcast: isDeposit });
    const { driver, store } = driverOn(fake);

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("halted"));
    expect(driver.getProgress().failure?.reason).not.toBe("pending");
    expect(driver.getProgress().moneyMoved).toBeUndefined();

    driver.reset();
    expect(store.load(FLOW_ID)).toBeNull();
  });

  it("reads no nonce for a rejection", async () => {
    const fake = chain({
      error: () => new UserRejectedRequestError(new Error("User denied transaction signature.")),
      failBeforeBroadcast: isDeposit,
    });
    const sentWithNonce = vi.spyOn(fake.reader, "sentWithNonce");
    const { driver } = driverOn(fake);

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("halted"));

    expect(driver.getProgress().failure?.reason).toBe("rejected");
    expect(sentWithNonce).not.toHaveBeenCalled();
  });
});
