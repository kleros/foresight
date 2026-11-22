import { createFlowRunStore, createMemoryStorage, type FlowTx, type TxGateway } from "@foresight/tx-orchestrator";
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
import type { PredictReader, SentTx } from "../../flow/types";
import { createPredictRun, SEND_HOLD_MS } from "../driver";
import type { PredictDriver } from "../types";

/** maySend answers from `allowed`, as the page's status reads at the moment it is asked. */
const gate = () => {
  const state = { allowed: true, asked: 0 };
  const maySend = () => {
    state.asked++;
    return Promise.resolve(state.allowed);
  };
  return { state, maySend };
};

const isDeposit = (tx: FlowTx) => tx.to === addresses.collateral;
const isBatch = (tx: FlowTx) => tx.to === addresses.executor;

/** A coded wallet error that the wallet raised before broadcasting, so the send is held while its nonce is unused. */
const internalError = () =>
  new Error("Transaction failed", { cause: Object.assign(new Error("Internal JSON-RPC error."), { code: -32603 }) });

/**
 * Mines the owner's sends in nonce order. The first send `failFirst` picks throws `internalError` without a nonce;
 * `surface(tx)` mines `tx` under the next nonce, as a wallet does that sent a prompt the page lost track of.
 */
function chain(opts: { failFirst?: (tx: FlowTx) => boolean } = {}) {
  const byNonce: Array<{ hash: Hash; tx: FlowTx }> = [];
  const sends: FlowTx[] = [];
  let failed = false;
  const receipt = (hash: Hash) =>
    ({ transactionHash: hash, status: "success", blockNumber: 1n, logs: [] }) as unknown as TransactionReceipt;
  const mine = (tx: FlowTx) => {
    const hash = `0x${(byNonce.length + 1).toString(16).padStart(64, "0")}` as Hash;
    byNonce.push({ hash, tx });
    return hash;
  };

  const gateway: TxGateway = {
    sendTransaction: (tx) => {
      sends.push(tx);
      if (!failed && opts.failFirst?.(tx)) {
        failed = true;
        return Promise.reject(internalError());
      }
      return Promise.resolve(mine(tx));
    },
    waitForReceipt: ({ hash }) => Promise.resolve(receipt(hash)),
    getReceipt: (hash) => Promise.resolve(receipt(hash)),
    isKnown: () => Promise.resolve(true),
  };

  const sentWithNonce = ({ nonce }: { nonce: number }): Promise<SentTx> => {
    const sent = byNonce[nonce];
    if (!sent) return Promise.resolve({ status: "none" });
    const { to, value = 0n, data = "0x" } = sent.tx;
    return Promise.resolve({ status: "mined", hash: sent.hash, to, value, input: data, success: true });
  };

  return {
    gateway,
    sends,
    surface: (tx: FlowTx) => void mine(tx),
    reader: {
      ...fakeReader({ deployed: true }),
      nextNonce: () => Promise.resolve(byNonce.length),
      sentWithNonce,
    } satisfies PredictReader,
  };
}

const drivers: PredictDriver[] = [];
afterEach(() => {
  for (const driver of drivers.splice(0)) driver.dispose();
});

const clock = { at: 1_700_000_000_000 };

function driverOn(fake: { gateway: TxGateway; reader: PredictReader }, maySend: () => Promise<boolean>) {
  const driver = createPredictRun({
    gateway: fake.gateway,
    reader: fake.reader,
    quoter: fakeQuoter(),
    flowId: `predict-send-gate-${drivers.length}`,
    ctx: () => ctx(),
    snapshot: () => snapshot(),
    store: createFlowRunStore({ storage: createMemoryStorage() }),
    now: () => clock.at,
    unansweredSend: { waitMs: 20, pollMs: 5 },
    maySend,
  });
  drivers.push(driver);
  return driver;
}

describe("createPredictRun asks the page before each wallet send", () => {
  it("sends nothing when permission is withdrawn while the nonce is read", async () => {
    const fake = chain();
    const { state, maySend } = gate();
    let releaseNonce: () => void = () => {};
    const nonceRead = new Promise<void>((release) => (releaseNonce = release));
    const reader = { ...fake.reader, nextNonce: () => nonceRead.then(() => 0) };
    const driver = driverOn({ gateway: fake.gateway, reader }, maySend);

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("signing"));
    state.allowed = false;
    releaseNonce();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("halted"));

    expect(fake.sends).toEqual([]);
    expect(driver.getProgress().failure).toEqual({ reason: "refused", retryable: true });
    expect(driver.getProgress().unanswered).toBeUndefined();
  });

  it("sends nothing when permission is refused by the read made for it", async () => {
    const fake = chain();
    const driver = driverOn(fake, () => Promise.reject(new Error("HTTP request failed")));

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("halted"));

    expect(fake.sends).toEqual([]);
    expect(driver.getProgress().failure?.reason).toBe("refused");
  });

  it("refuses the send after a deposit that landed, then signs it once permission is back", async () => {
    const fake = chain();
    let refusing = true;
    const driver = driverOn(fake, () => Promise.resolve(!(refusing && fake.sends.some(isDeposit))));

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("halted"));
    expect(fake.sends.filter(isDeposit)).toHaveLength(1);
    expect(fake.sends.filter(isBatch)).toHaveLength(0);
    expect(driver.getProgress().failure).toEqual({ reason: "refused", retryable: true });

    refusing = false;
    driver.retry();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("complete"));
    expect(fake.sends.filter(isDeposit)).toHaveLength(1);
    expect(fake.sends.filter(isBatch)).toHaveLength(1);
  });
});

describe("createPredictRun under a refusal, on a held send past its hold", () => {
  async function askedToSignAgain(fake: ReturnType<typeof chain>, maySend: () => Promise<boolean>) {
    const driver = driverOn(fake, maySend);
    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().failure?.reason).toBe("held"));
    clock.at += SEND_HOLD_MS;
    driver.retry();
    await vi.waitFor(() => expect(driver.getProgress().failure).toEqual({ reason: "resign", retryable: true }));
    return driver;
  }

  it("reads the nonce again on the press and keeps the held send, signing nothing", async () => {
    const fake = chain({ failFirst: isDeposit });
    const { state, maySend } = gate();
    const driver = await askedToSignAgain(fake, maySend);
    state.allowed = false;
    const reads = vi.spyOn(fake.reader, "sentWithNonce");

    driver.retry();
    await vi.waitFor(() => expect(reads).toHaveBeenCalled());
    await vi.waitFor(() => expect(driver.getProgress().failure?.reason).toBe("resign"));

    expect(fake.sends.filter(isDeposit)).toHaveLength(1);
    expect(driver.getProgress().unanswered).toBe(true);

    state.allowed = true;
    driver.retry();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("complete"));
    expect(fake.sends.filter(isDeposit)).toHaveLength(2);
  });

  it("takes up a held send that mined late, and refuses only what comes after it", async () => {
    const fake = chain({ failFirst: isDeposit });
    const { state, maySend } = gate();
    const driver = await askedToSignAgain(fake, maySend);
    state.allowed = false;
    fake.surface(fake.sends.find(isDeposit)!);

    driver.retry();
    await vi.waitFor(() => expect(driver.getProgress().failure?.reason).toBe("refused"));

    expect(fake.sends.filter(isDeposit)).toHaveLength(1);
    expect(fake.sends.filter(isBatch)).toHaveLength(0);
    expect(driver.getProgress().unanswered).toBeUndefined();
  });
});

/** The third send is the second batch, whose hash no node finds. */
function unseenBatchGateway(): TxGateway & { readonly signRequests: FlowTx[] } {
  const signRequests: FlowTx[] = [];
  const unseen = new Set<Hash>();
  const receipt = (hash: Hash) => ({ transactionHash: hash, status: "success", blockNumber: 1n }) as TransactionReceipt;
  return {
    signRequests,
    sendTransaction: (tx) => {
      signRequests.push(tx);
      const hash = `0x${signRequests.length.toString(16).padStart(64, "0")}` as Hash;
      if (signRequests.length === 3) unseen.add(hash);
      return Promise.resolve(hash);
    },
    waitForReceipt: ({ hash }) =>
      unseen.has(hash)
        ? Promise.reject(new Error("node said something odd", { cause: "opaque" }))
        : Promise.resolve(receipt(hash)),
    getReceipt: (hash) => Promise.resolve(unseen.has(hash) ? null : receipt(hash)),
    isKnown: (hash) => Promise.resolve(!unseen.has(hash)),
  };
}

describe("createPredictRun under a refusal, on a sent hash no node finds past its hold", () => {
  it("keeps the hash on the press and signs nothing until permission is back", async () => {
    const gateway = unseenBatchGateway();
    const { state, maySend } = gate();
    const driver = createPredictRun({
      gateway,
      now: () => clock.at,
      reader: {
        ...fakeReader({
          deployed: true,
          collateral: 0n,
          state: () => chainState({ underlying: WAD }),
          blockGasLimit: gasLimitFor(1),
        }),
        sentWithNonce: () => Promise.resolve({ status: "none" }),
      },
      quoter: fakeQuoter(),
      flowId: "predict-send-gate-unseen",
      ctx: () => ctx(),
      snapshot: () => snapshot({ options: [option(1), option(2)], deposit: WAD, collateralIn: WAD }),
      maySend,
    });
    drivers.push(driver);

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().pendingHash).toBeDefined());
    const hash = driver.getProgress().pendingHash;
    clock.at += SEND_HOLD_MS;
    driver.retry();
    await vi.waitFor(() => expect(driver.getProgress().failure?.reason).toBe("resign"));

    state.allowed = false;
    const asked = state.asked;
    driver.retry();
    await vi.waitFor(() => expect(state.asked).toBeGreaterThan(asked));
    await vi.waitFor(() => expect(driver.getProgress().failure?.reason).toBe("resign"));
    expect(driver.getProgress().pendingHash).toBe(hash);
    expect(gateway.signRequests).toHaveLength(3);

    state.allowed = true;
    driver.retry();
    await vi.waitFor(() => expect(gateway.signRequests).toHaveLength(4));
  });
});
