import { createFlowRunStore, createMemoryStorage, type FlowTx, type TxGateway } from "@foresight/tx-orchestrator";
import { UserRejectedRequestError, type Address, type Hash, type PublicClient, type TransactionReceipt } from "viem";
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
import type { LandedTx, PredictRequest, SentTx } from "../../flow/types";
import { createPredictRun } from "../driver";
import { discardRun, hasPendingTransaction, predictFlowId } from "../interrupted";
import { createPredictReader } from "../reader";
import type { PredictDriver } from "../types";

// the indexer's client reads the app's environment, and no nonce read goes near it
vi.mock("../../api/getOptionPools", () => ({ fetchSessionPools: vi.fn(), optionPoolRefs: vi.fn() }));

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

  /** The owner's count after block `at`, or with every broadcast where `at` is pending. */
  const countAt = (at: bigint | "pending") =>
    at === "pending" ? byNonce.length : byNonce.filter((sent) => sent.block !== undefined && sent.block <= at).length;

  /** The app's node over the same chain, as the reader reads it. */
  const client = {
    getTransactionCount: ({ blockTag, blockNumber }: { blockTag?: "latest" | "pending"; blockNumber?: bigint }) =>
      Promise.resolve(countAt(blockNumber ?? (blockTag === "pending" ? "pending" : head))),
    getBlockNumber: () => Promise.resolve(head),
    getBlock: ({ blockNumber }: { blockNumber: bigint }) =>
      Promise.resolve({
        number: blockNumber,
        transactions: byNonce.flatMap((sent, nonce) =>
          sent.block === blockNumber
            ? [
                {
                  from: addresses.owner,
                  nonce,
                  hash: sent.hash,
                  to: sent.tx.to,
                  value: 0n,
                  input: sent.tx.data ?? "0x",
                },
              ]
            : [],
        ),
      }),
    getTransactionReceipt: () => Promise.resolve({ status: "success" }),
  } as unknown as PublicClient;

  return {
    gateway,
    client,
    /** The owner's counts on a node `lag()` blocks behind the head, which has seen no broadcast past them. */
    countsBehind: (lag: () => bigint) => (_owner: Address, _tag: "latest" | "pending") =>
      Promise.resolve(countAt(head - lag())),
    deposits: () => sends.filter(isDeposit).length,
    batches: () => sends.filter((tx) => tx.to === addresses.executor),
    /** Mines `tx`, which no read had seen, under the owner's next nonce; `pending` leaves it broadcast. */
    surfaces: (tx: FlowTx, pending = false) => {
      const nonce = byNonce.length;
      byNonce.push({
        hash: `0x${(nonce + 1).toString(16).padStart(64, "0")}` as Hash,
        tx,
        ...(pending ? {} : { block: ++head }),
      });
    },
    land: () => {
      for (const sent of byNonce) if (sent.block === undefined) sent.block = ++head;
    },
    /** Mines a transfer elsewhere under the owner's next nonce. */
    takeNonce: () => {
      const nonce = byNonce.length;
      byNonce.push({
        hash: `0x${(nonce + 1).toString(16).padStart(64, "f")}` as Hash,
        tx: { to: addresses.executor, data: "0x" },
        block: ++head,
      });
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

/** Ten minutes, the hold on a send whose nonce reads unused. */
const HOLD_MS = 600_000;

const clock = { at: 1_700_000_000_000 };

function driverOn(
  fake: Pick<ReturnType<typeof chain>, "gateway" | "reader">,
  store = createFlowRunStore({ storage: createMemoryStorage() }),
  request: PredictRequest = snapshot(),
) {
  const driver = createPredictRun({
    gateway: fake.gateway,
    reader: fake.reader,
    quoter: fakeQuoter(),
    flowId: FLOW_ID,
    ctx: () => ctx(),
    snapshot: () => request,
    store,
    now: () => clock.at,
    unansweredSend: { waitMs: 20, pollMs: 5 },
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

  it("holds a coded error whose nonce reads unused, and signs nothing again within ten minutes", async () => {
    const fake = chain({ error: internalError, failBeforeBroadcast: isDeposit });
    const { driver, store } = driverOn(fake);

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("halted"));
    expect(driver.getProgress().failure).toEqual({ reason: "held", retryable: true });
    expect(driver.getProgress().unanswered).toBe(true);

    driver.reset();
    expect(store.load(FLOW_ID)).not.toBeNull();

    clock.at += HOLD_MS - 1;
    driver.retry();
    await vi.waitFor(() => expect(driver.getProgress().failure?.reason).toBe("held"));
    expect(fake.deposits()).toBe(1);
  });

  it("asks before signing again once the nonce stays unused for ten minutes, and signs on the answer", async () => {
    const fake = chain({ error: internalError, failBeforeBroadcast: isDeposit });
    const { driver } = driverOn(fake);

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().failure?.reason).toBe("held"));
    clock.at += HOLD_MS;
    driver.retry();
    await vi.waitFor(() => expect(driver.getProgress().failure).toEqual({ reason: "resign", retryable: true }));
    expect(fake.deposits()).toBe(1);

    driver.retry();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("complete"));
    expect(fake.deposits()).toBe(2);
  });

  it("asks before signing again when it recovers a held send past ten minutes", async () => {
    const fake = chain({ error: internalError, failBeforeBroadcast: isDeposit });
    const { driver, store } = driverOn(fake);

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().failure?.reason).toBe("held"));
    driver.dispose();
    clock.at += HOLD_MS;

    const { driver: next } = driverOn(fake, store);
    next.recover();
    await vi.waitFor(() => expect(next.getProgress().stage).toBe("review"));
    next.resume();
    await vi.waitFor(() => expect(next.getProgress().failure?.reason).toBe("resign"));
    expect(fake.deposits()).toBe(1);
  });

  it("signs again without asking once another transaction took the held send's nonce", async () => {
    const fake = chain({ error: internalError, failBeforeBroadcast: isDeposit });
    const { driver } = driverOn(fake);

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().failure?.reason).toBe("held"));
    fake.takeNonce();
    driver.retry();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("complete"));
    expect(fake.deposits()).toBe(2);
  });

  it("holds a send whose internal error reads like a decline, since only a decline's code proves nothing went out", async () => {
    const fake = chain({
      error: () =>
        new Error("Transaction failed", {
          cause: Object.assign(new Error("Internal JSON-RPC error: request rejected"), { code: -32603 }),
        }),
      broadcastThenFail: isDeposit,
    });
    const { driver, store } = driverOn(fake);

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("halted"));
    expect(driver.getProgress().failure?.reason).toBe("pending");

    driver.reset();
    expect(store.load(FLOW_ID)).not.toBeNull();
  });

  it("holds a send whose nonce the wallet's node, a block behind as it is sent, reads as one already used", async () => {
    const fake = chain({ error: internalError, failBeforeBroadcast: isDeposit });
    fake.takeNonce();
    let lag = 1n;
    const nodes = createPredictReader({
      client: fake.client,
      sessionId: SESSION,
      collateral: addresses.collateral,
      walletNonce: fake.countsBehind(() => lag),
    });
    const { nextNonce, sentWithNonce, hasPending } = nodes;
    const gateway = {
      ...fake.gateway,
      sendTransaction: (tx: FlowTx) => {
        lag = 0n;
        return fake.gateway.sendTransaction(tx);
      },
    };
    const { driver } = driverOn({ ...fake, gateway, reader: { ...fake.reader, nextNonce, sentWithNonce, hasPending } });

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("halted"));
    expect(driver.getProgress().failure).toEqual({ reason: "held", retryable: true });

    driver.retry();
    await vi.waitFor(() => expect(driver.getProgress().failure?.reason).toBe("held"));
    expect(fake.deposits()).toBe(1);
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

describe("createPredictRun when the visitor answers Sign again", () => {
  /** Two batches; the second's send errors before any read sees it, and is held. */
  async function heldSecondBatch() {
    const fake = chain({
      error: internalError,
      failBeforeBroadcast: (tx) => tx.to === addresses.executor && fake.batches().length === 2,
    });
    const reader = {
      ...fake.reader,
      optionStates: fakeReader({ state: () => chainState({ underlying: WAD }) }).optionStates,
      blockGasLimit: () => Promise.resolve(gasLimitFor(1)),
    };
    const { driver } = driverOn(
      { gateway: fake.gateway, reader },
      undefined,
      snapshot({ options: [option(1), option(2)] }),
    );
    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().failure?.reason).toBe("held"));
    clock.at += HOLD_MS;
    driver.retry();
    await vi.waitFor(() => expect(driver.getProgress().failure?.reason).toBe("resign"));
    expect(fake.batches()).toHaveLength(2);
    return { fake, driver, held: fake.batches()[1]! };
  }

  it("signs nothing when the held batch mined while the ask was shown", async () => {
    const { fake, driver, held } = await heldSecondBatch();
    fake.surfaces(held);

    driver.retry();
    await vi.waitFor(() => expect(["halted", "complete"]).toContain(driver.getProgress().stage));
    expect(driver.getProgress().stage).toBe("complete");
    expect(fake.batches()).toHaveLength(2);
  });

  it("says it is pending when the held batch was broadcast while the ask was shown", async () => {
    const { fake, driver, held } = await heldSecondBatch();
    fake.surfaces(held, true);

    driver.retry();
    await vi.waitFor(() => expect(driver.getProgress().failure?.reason).toBe("pending"));
    expect(fake.batches()).toHaveLength(2);
  });

  it("signs the batch again when its nonce still reads unused", async () => {
    const { fake, driver } = await heldSecondBatch();

    driver.retry();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("complete"));
    expect(fake.batches()).toHaveLength(3);
  });
});

describe("createPredictRun recovering a held send after the session closed", () => {
  it("reads how the send ended and lets the run go, signing nothing", async () => {
    const fake = chain({ error: internalError, broadcastThenFail: isDeposit });
    const closesAt = 1_800_000_000;
    let now = BigInt(closesAt - 60);
    const reader = { ...fake.reader, latestTimestamp: () => Promise.resolve(now) };
    const store = createFlowRunStore({ storage: createMemoryStorage() });
    const open = () => {
      const driver = createPredictRun({
        gateway: fake.gateway,
        reader,
        quoter: fakeQuoter(),
        flowId: FLOW_ID,
        ctx: () => ctx(),
        snapshot: () => snapshot(),
        store,
        closesAt,
        unansweredSend: { waitMs: 20, pollMs: 5 },
      });
      drivers.push(driver);
      return driver;
    };

    const first = open();
    first.start();
    await vi.waitFor(() => expect(first.getProgress().failure?.reason).toBe("pending"));
    first.dispose();
    fake.land();
    now = BigInt(closesAt + 60);
    const sentBefore = fake.deposits();

    const reopened = open();
    reopened.recover();
    await vi.waitFor(() => expect(reopened.getProgress().failure?.reason).toBe("closed"));
    expect(fake.deposits()).toBe(sentBefore);
    expect(hasPendingTransaction(store, SESSION, addresses.owner)).toBe(false);
    reopened.reset();
    expect(store.load(FLOW_ID)).toBeNull();
  });
});
