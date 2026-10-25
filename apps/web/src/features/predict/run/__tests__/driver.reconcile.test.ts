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
import type { PredictReader, SentTx } from "../../flow/types";
import { createPredictRun, SEND_HOLD_MS } from "../driver";
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

const clock = { at: 1_700_000_000_000 };

function setup(
  gateway: TxGateway,
  store?: FlowRunStore,
  flowId = `predict-reconcile-${drivers.length}`,
  sentWithNonce?: PredictReader["sentWithNonce"],
) {
  const reader = fakeReader({
    deployed: true,
    collateral: 0n,
    state: () => chainState({ underlying: WAD }),
    blockGasLimit: gasLimitFor(1),
  });
  const driver = createPredictRun({
    gateway,
    store,
    now: () => clock.at,
    reader: sentWithNonce ? { ...reader, sentWithNonce } : reader,
    quoter: fakeQuoter(),
    flowId,
    ctx: () => ctx(),
    snapshot: () => snapshot({ options: [option(1), option(2)], deposit: WAD, collateralIn: WAD }),
  });
  drivers.push(driver);
  return driver;
}

describe("createPredictRun when a batch's receipt was never seen", () => {
  it("keeps the hash while its nonce reads unused, offering Check again and signing nothing", async () => {
    const gateway = unseenBatchGateway({
      waitError: () => new Error("node said something odd", { cause: "opaque" }),
      lookup: "dropped",
    });
    const driver = setup(gateway);

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().pendingHash).toBeDefined());
    const hash = driver.getProgress().pendingHash;

    driver.retry();
    await vi.waitFor(() => expect(driver.getProgress().failure).toEqual({ reason: "unseen", retryable: true }));
    clock.at += SEND_HOLD_MS - 1;
    driver.retry();
    await vi.waitFor(() => expect(driver.getProgress().failure?.reason).toBe("unseen"));

    expect(driver.getProgress().pendingHash).toBe(hash);
    expect(gateway.signRequests).toHaveLength(3);
  });

  it("asks before signing again once the nonce stayed unused for ten minutes, and signs on the answer", async () => {
    const gateway = unseenBatchGateway({
      waitError: () => new Error("node said something odd", { cause: "opaque" }),
      lookup: "dropped",
    });
    const driver = setup(gateway);

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().pendingHash).toBeDefined());
    clock.at += SEND_HOLD_MS;
    driver.retry();
    await vi.waitFor(() => expect(driver.getProgress().failure).toEqual({ reason: "resign", retryable: true }));
    expect(gateway.signRequests).toHaveLength(3);

    driver.retry();
    await vi.waitFor(() => expect(gateway.signRequests).toHaveLength(4));
    expect(isBatch(gateway.signRequests[3]!)).toBe(true);
  });

  it("on the answer to the ask, signs nothing when the batch mined under its nonce meanwhile", async () => {
    const gateway = unseenBatchGateway({
      waitError: () => new Error("node said something odd", { cause: "opaque" }),
      lookup: "dropped",
    });
    let minedAs: SentTx | undefined;
    const driver = setup(gateway, undefined, undefined, ({ nonce }) =>
      Promise.resolve(nonce === 0 && minedAs ? minedAs : { status: "none" }),
    );

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().pendingHash).toBeDefined());
    clock.at += SEND_HOLD_MS;
    driver.retry();
    await vi.waitFor(() => expect(driver.getProgress().failure?.reason).toBe("resign"));
    const batch = gateway.signRequests[2]!;
    minedAs = {
      status: "mined",
      hash: `0x${"a".repeat(64)}`,
      to: batch.to,
      value: batch.value ?? 0n,
      input: batch.data ?? "0x",
      success: true,
    };

    driver.retry();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("complete"));
    expect(gateway.signRequests).toHaveLength(3);
  });

  it("on the answer to the ask, says it is pending when the batch was broadcast meanwhile", async () => {
    const gateway = unseenBatchGateway({
      waitError: () => new Error("node said something odd", { cause: "opaque" }),
      lookup: "dropped",
    });
    let broadcast = false;
    const driver = setup(gateway, undefined, undefined, ({ nonce }) =>
      Promise.resolve(nonce === 0 && broadcast ? { status: "pending" } : { status: "none" }),
    );

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().pendingHash).toBeDefined());
    clock.at += SEND_HOLD_MS;
    driver.retry();
    await vi.waitFor(() => expect(driver.getProgress().failure?.reason).toBe("resign"));
    broadcast = true;

    driver.retry();
    await vi.waitFor(() => expect(driver.getProgress().failure?.reason).toBe("pending"));
    expect(gateway.signRequests).toHaveLength(3);
  });

  it("lets the hash go once its nonce went to another transaction, and rebuilds the batch on the next press", async () => {
    const gateway = unseenBatchGateway({
      waitError: () => new Error("node said something odd", { cause: "opaque" }),
      lookup: "dropped",
    });
    const other: SentTx = {
      status: "mined",
      hash: `0x${"e".repeat(64)}`,
      to: addresses.owner,
      value: 1n,
      input: "0x",
      success: true,
    };
    const driver = setup(gateway, undefined, undefined, ({ nonce }) =>
      Promise.resolve(nonce === 0 && gateway.signRequests.length >= 3 ? other : { status: "none" }),
    );

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().pendingHash).toBeDefined());
    driver.retry();
    await vi.waitFor(() => expect(driver.getProgress().pendingHash).toBeUndefined());
    expect(driver.getProgress().failure).toEqual({ reason: "unknown", retryable: true });
    expect(gateway.signRequests).toHaveLength(3);

    driver.retry();
    await vi.waitFor(() => expect(gateway.signRequests).toHaveLength(4));
    expect(isBatch(gateway.signRequests[3]!)).toBe(true);
  });

  it("waits on the hash the same transaction mined under when the wallet replaced it", async () => {
    const gateway = unseenBatchGateway({
      waitError: () => new Error("node said something odd", { cause: "opaque" }),
      lookup: "dropped",
    });
    const replacement = `0x${"a".repeat(64)}` as Hash;
    const driver = setup(gateway, undefined, undefined, ({ nonce }) => {
      const batch = gateway.signRequests[2];
      if (nonce !== 0 || !batch) return Promise.resolve({ status: "none" });
      return Promise.resolve({
        status: "mined",
        hash: replacement,
        to: batch.to,
        value: batch.value ?? 0n,
        input: batch.data ?? "0x",
        success: true,
      });
    });

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().pendingHash).toBeDefined());
    driver.retry();
    await vi.waitFor(() => expect(driver.getProgress().stage).toBe("complete"));

    expect(driver.getProgress().steps.at(-1)?.hash).toBe(replacement);
    expect(gateway.signRequests).toHaveLength(3);
  });

  it("forgets the run on Discard, once the hash is held", async () => {
    const store = createFlowRunStore({ storage: createMemoryStorage() });
    const gateway = unseenBatchGateway({
      waitError: () => new Error("node said something odd", { cause: "opaque" }),
      lookup: "dropped",
    });
    const driver = setup(gateway, store, "predict-reconcile-discard");

    driver.start();
    await vi.waitFor(() => expect(driver.getProgress().pendingHash).toBeDefined());
    driver.discard();
    expect(store.load("predict-reconcile-discard")).not.toBeNull();

    driver.retry();
    await vi.waitFor(() => expect(driver.getProgress().failure?.reason).toBe("unseen"));
    driver.discard();

    expect(store.load("predict-reconcile-discard")).toBeNull();
    expect(driver.getProgress().stage).toBe("idle");
    expect(gateway.signRequests).toHaveLength(3);
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
