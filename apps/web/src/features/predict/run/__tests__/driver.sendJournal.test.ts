import {
  createFlowRunStore,
  createMemoryStorage,
  type FlowRunStorage,
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
import type { LandedTx, PredictCtx, PredictSnapshot, SentTx } from "../../flow/types";
import { createPredictRun } from "../driver";
import { discardRun, hasPendingTransaction, predictFlowId } from "../interrupted";
import type { PredictDriver } from "../types";

const SESSION = "session-1";
const FLOW_ID = predictFlowId(SESSION, addresses.owner);

const isBatch = (tx: FlowTx) => tx.to === addresses.executor;

function copyStorage(from: FlowRunStorage): FlowRunStorage {
  const copy = createMemoryStorage();
  for (const key of from.keys()) copy.setItem(key, from.getItem(key)!);
  return copy;
}

/**
 * A chain that mines the owner's sends in nonce order. The wallet prompt for the `hangAt`-th batch stays open:
 * its call never answers, and `approve()` later broadcasts it at the next nonce, unmined until `land()`.
 */
function chain(opts: { hangAt?: number } = {}) {
  const byNonce: Array<{ hash: Hash; tx: FlowTx; block?: bigint }> = [];
  const sends: FlowTx[] = [];
  let head = 1n;
  let batches = 0;
  let open: FlowTx | undefined;
  let onPrompt: (() => void) | undefined;

  const receipt = (hash: Hash) =>
    ({ transactionHash: hash, status: "success", blockNumber: head, logs: [] }) as unknown as TransactionReceipt;

  const broadcast = (tx: FlowTx) => {
    const hash = `0x${(byNonce.length + 1).toString(16).padStart(64, "0")}` as Hash;
    byNonce.push({ hash, tx });
    return hash;
  };

  const gateway: TxGateway = {
    sendTransaction: (tx) => {
      sends.push(tx);
      if (isBatch(tx) && ++batches === opts.hangAt) {
        open = tx;
        onPrompt?.();
        return new Promise<Hash>(() => {});
      }
      const hash = broadcast(tx);
      byNonce[byNonce.length - 1]!.block = ++head;
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
    batchSends: () => sends.filter(isBatch).length,
    prompted: () => new Promise<void>((resolve) => (open ? resolve() : (onPrompt = resolve))),
    /** The visitor approves the open prompt after the tab that asked is gone. */
    approve: () => broadcast(open!),
    land: () => {
      for (const sent of byNonce) if (sent.block === undefined) sent.block = ++head;
    },
    reader: {
      // every option holds underlying, so a batch after the first, which splits nothing, still trades
      ...fakeReader({ deployed: true, blockGasLimit: gasLimitFor(1), state: () => chainState({ underlying: WAD }) }),
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

function driverOn(fake: ReturnType<typeof chain>, storage: FlowRunStorage = createMemoryStorage()) {
  const store = createFlowRunStore({ storage });
  const driver = createPredictRun({
    gateway: fake.gateway,
    reader: fake.reader,
    quoter: fakeQuoter(),
    flowId: FLOW_ID,
    ctx: () => ctx(),
    snapshot: () => snapshot({ options: [option(1), option(2)] }),
    store,
    unansweredSend: { waitMs: 20, pollMs: 5, graceMs: 20 },
  });
  drivers.push(driver);
  return { driver, store, storage };
}

/** Starts a two-batch run, single option each, and returns the storage a tab closed at the second batch's prompt leaves. */
async function closedAtSecondBatch(fake: ReturnType<typeof chain>) {
  const { driver, storage } = driverOn(fake);
  driver.start();
  await fake.prompted();
  // the prompt is open once the wallet call is made; the tab closes with nothing more written
  return { driver, left: copyStorage(storage) };
}

async function recoverAndResume(fake: ReturnType<typeof chain>, storage: FlowRunStorage) {
  const { driver } = driverOn(fake, storage);
  driver.recover();
  await vi.waitFor(() => expect(driver.getProgress().stage).toBe("review"));
  driver.resume();
  await vi.waitFor(() => expect(["halted", "complete"]).toContain(driver.getProgress().stage));
  return driver;
}

describe("createPredictRun with a wallet prompt left open as the tab closed", () => {
  it("stores the send with the run before the wallet is asked, so Discard keeps it", async () => {
    const fake = chain({ hangAt: 2 });
    const { left } = await closedAtSecondBatch(fake);

    const store = createFlowRunStore({ storage: left });
    expect(store.load<PredictSnapshot, PredictCtx>(FLOW_ID)?.snapshot.unanswered?.["predict-2"]).toBeDefined();
    expect(hasPendingTransaction(store, SESSION, addresses.owner)).toBe(true);
    discardRun(store, SESSION, addresses.owner);
    expect(store.load(FLOW_ID)).not.toBeNull();
  });

  it("signs a later batch approved after the close no second time while it is pending", async () => {
    const fake = chain({ hangAt: 2 });
    const { left } = await closedAtSecondBatch(fake);
    fake.approve();

    const driver = await recoverAndResume(fake, left);
    expect(driver.getProgress().failure?.reason).toBe("pending");
    expect(fake.batchSends()).toBe(2);

    fake.land();
    driver.retry();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("complete"));
    expect(fake.batchSends()).toBe(2);
  });

  it("skips a later batch approved after the close once it mined", async () => {
    const fake = chain({ hangAt: 2 });
    const { left } = await closedAtSecondBatch(fake);
    fake.approve();
    fake.land();

    const driver = await recoverAndResume(fake, left);
    expect(driver.getProgress().stage).toBe("complete");
    expect(fake.batchSends()).toBe(2);
  });

  it("keeps the send with the run when the popup is disposed while the prompt is open", async () => {
    const fake = chain({ hangAt: 2 });
    const { driver, storage } = driverOn(fake);
    driver.start();
    await fake.prompted();
    driver.dispose();
    fake.approve();
    fake.land();

    const next = await recoverAndResume(fake, storage);
    expect(next.getProgress().stage).toBe("complete");
    expect(fake.batchSends()).toBe(2);
  });
});

describe("createPredictRun settling a held send it finds mined", () => {
  it("never stores the step pending with neither its hash nor its held send", async () => {
    const fake = chain({ hangAt: 2 });
    const { left } = await closedAtSecondBatch(fake);
    fake.approve();
    fake.land();

    // every record written, read back as a reload would
    const written: Array<{ status?: string; held: boolean }> = [];
    const watched: FlowRunStorage = {
      ...left,
      keys: () => left.keys(),
      getItem: (key) => left.getItem(key),
      removeItem: (key) => left.removeItem(key),
      setItem: (key, value) => {
        left.setItem(key, value);
        const record = createFlowRunStore({ storage: left }).load<PredictSnapshot, PredictCtx>(FLOW_ID);
        const step = record?.steps.find((each) => each.stepId === "predict-2");
        written.push({ status: step?.outcome.status, held: Boolean(record?.snapshot.unanswered?.["predict-2"]) });
      },
    };

    const driver = await recoverAndResume(fake, watched);
    expect(driver.getProgress().stage).toBe("complete");
    expect(
      written.filter(({ status, held }) => (status === "pending" || status === "awaiting-signature") && !held),
    ).toEqual([]);
  });
});
