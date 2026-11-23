import type { FlowRunStorage } from "@foresight/tx-orchestrator";
import type { Hash } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  newWorld,
  OWNER,
  progress,
  reached,
  recovered,
  runs,
  settled,
  stored,
  tab,
  tick,
  type World,
} from "./support/tabs";
import { copyStorage } from "./support/world";

afterEach(() => {
  for (const run of runs.splice(0)) run.dispose();
});

/** EIP-5792 v2 statuses: 1xx pending, 2xx landed, 300 and above did not land. */
const PENDING = [100, 199];
const LANDED = [200, 299];
const FAILED = [300, 400, 500, 600];

const UNKNOWN_BUNDLE = Object.assign(new Error("Unknown bundle id"), { code: 5730 });
const INTERNAL = Object.assign(new Error("Internal JSON-RPC error."), { code: -32603 });

const sendCallsOf = (requests: { method: string }[]) => requests.filter((each) => each.method === "wallet_sendCalls");

/** An atomic run whose batch the wallet took and never answered, left in storage when its tab closed. */
async function storedBatch(world: World) {
  const first = tab(world, {
    atomic: true,
    answer: (method) => (method === "wallet_sendCalls" ? new Promise(() => {}) : undefined),
  });
  first.run.start();
  await vi.waitFor(() => expect(sendCallsOf(first.requests)).toHaveLength(1));
  await tick();
  const left = copyStorage(first.storage);
  first.run.dispose();
  const id = stored(left)!.callsId!;
  expect(id).toBeDefined();
  return { left, id };
}

/** A tab on `left` whose wallet answers wallet_getCallsStatus for `id` with `answer`. */
function reloaded(world: World, left: FlowRunStorage, id: string, answer: () => Promise<unknown>) {
  return recovered(world, left, {
    atomic: true,
    answer: (method, params) =>
      method === "wallet_getCallsStatus" && (params as [string])[0] === id ? answer() : undefined,
  });
}

const status = (code: number) => () => Promise.resolve({ version: "2.0.0", status: code, atomic: true });

describe("createRedeemRun halts a reloaded batch the wallet reports failed", () => {
  it.each([400, 500])(
    "status %i: halts as batch-failed, sends nothing, and the next Redeem sends one new batch",
    async (code) => {
      const world = newWorld();
      const { left, id } = await storedBatch(world);
      const { run, sends, requests } = await reloaded(world, left, id, status(code));
      expect(progress(run).stage).toBe("review");

      run.resume();
      await settled(run);
      run.retry();
      await tick();

      expect(progress(run).failure).toEqual({ reason: "batch-failed", retryable: false });
      expect(progress(run).holdsSend).toBeUndefined();
      expect(sendCallsOf(requests)).toEqual([]);
      expect(sends.prompts).toEqual([]);
      expect(stored(left)?.callsId).toBeUndefined();

      run.start();
      await reached(run, "complete");
      const sent = sendCallsOf(requests);
      expect(sent).toHaveLength(1);
      expect((sent[0]!.params as [{ id: string }])[0].id).not.toBe(id);
      expect(sends.prompts).toEqual([]);
    },
  );
});

describe("createRedeemRun reads a reloaded batch's status by EIP-5792 v2", () => {
  it.each(PENDING)("status %i: stops as pending, keeping the batch id and sending nothing", async (code) => {
    const world = newWorld();
    const { left, id } = await storedBatch(world);
    const { run, requests } = await reloaded(world, left, id, status(code));

    run.resume();
    await settled(run);

    expect(progress(run).failure).toEqual({ reason: "pending", retryable: true });
    expect(progress(run).holdsSend).toBe(true);
    expect(stored(left)?.callsId).toBe(id);
    expect(sendCallsOf(requests)).toEqual([]);
  });

  it.each(LANDED)("status %i: counts the batch as landed and completes without sending it again", async (code) => {
    const world = newWorld();
    const { left, id } = await storedBatch(world);
    const { run, requests } = await reloaded(world, left, id, status(code));

    run.resume();
    await reached(run, "complete");

    expect(sendCallsOf(requests)).toEqual([]);
  });

  it.each(FAILED)("status %i: halts as batch-failed, forgetting the batch id and sending nothing", async (code) => {
    const world = newWorld();
    const { left, id } = await storedBatch(world);
    const { run, requests } = await reloaded(world, left, id, status(code));

    run.resume();
    await settled(run);

    expect(progress(run).failure).toEqual({ reason: "batch-failed", retryable: false });
    expect(progress(run).holdsSend).toBeUndefined();
    expect(stored(left)?.callsId).toBeUndefined();
    expect(sendCallsOf(requests)).toEqual([]);
  });

  it("error 5730: halts as batch-unknown, keeping the batch id", async () => {
    const world = newWorld();
    const { left, id } = await storedBatch(world);
    const { run, requests } = await reloaded(world, left, id, () => Promise.reject(UNKNOWN_BUNDLE));

    run.resume();
    await settled(run);

    expect(progress(run).failure).toEqual({ reason: "batch-unknown", retryable: false });
    expect(progress(run).holdsSend).toBe(true);
    expect(stored(left)?.callsId).toBe(id);
    expect(sendCallsOf(requests)).toEqual([]);
  });

  it("another error: stops with a retry, keeping the batch id and sending nothing", async () => {
    const world = newWorld();
    const { left, id } = await storedBatch(world);
    const { run, requests } = await reloaded(world, left, id, () => Promise.reject(INTERNAL));

    run.resume();
    await settled(run);

    expect(progress(run).stage).toBe("halted");
    expect(progress(run).failure?.retryable).toBe(true);
    expect(progress(run).holdsSend).toBe(true);
    expect(stored(left)?.callsId).toBe(id);
    expect(sendCallsOf(requests)).toEqual([]);
  });
});

/** An atomic tab whose wallet takes the batch, broadcasting nothing, and reports it with `answer()`. */
function polled(world: World, answer: (id: string) => Promise<unknown>) {
  let taken: string | undefined;
  const opened = tab(world, {
    atomic: true,
    answer: (method, params) => {
      if (method === "wallet_sendCalls") {
        taken = (params as [{ id: string }])[0].id;
        return Promise.resolve({ id: taken });
      }
      return method === "wallet_getCallsStatus" && (params as [string])[0] === taken ? answer(taken) : undefined;
    },
  });
  return { ...opened, id: () => taken };
}

const statusCalls = (requests: { method: string }[]) =>
  requests.filter((each) => each.method === "wallet_getCallsStatus").length;

describe("createRedeemRun polls a sent batch's status by EIP-5792 v2", () => {
  it.each(PENDING)("status %i: keeps polling while confirming, and completes once the batch lands", async (code) => {
    const world = newWorld();
    const landed: { hash?: Hash } = {};
    const { run, requests } = polled(world, () =>
      Promise.resolve(
        landed.hash ? { status: 200, receipts: [{ transactionHash: landed.hash }] } : { status: code, receipts: [] },
      ),
    );

    run.start();
    await vi.waitFor(() => expect(statusCalls(requests)).toBeGreaterThan(2));
    expect(progress(run).stage).toBe("confirming");

    landed.hash = world.fake.broadcast({ to: OWNER, data: "0x" }, OWNER, true).hash;
    await reached(run, "complete");
    expect(sendCallsOf(requests)).toHaveLength(1);
  });

  it.each(LANDED)("status %i with a receipt: completes", async (code) => {
    const world = newWorld();
    const { hash } = world.fake.broadcast({ to: OWNER, data: "0x" }, OWNER, true);
    const { run, requests } = polled(world, () =>
      Promise.resolve({ status: code, receipts: [{ transactionHash: hash }] }),
    );

    run.start();
    await reached(run, "complete");

    expect(sendCallsOf(requests)).toHaveLength(1);
  });

  it.each(LANDED)("status %i without a receipt: keeps polling", async (code) => {
    const world = newWorld();
    const { run, requests } = polled(world, () => Promise.resolve({ status: code }));

    run.start();
    await vi.waitFor(() => expect(statusCalls(requests)).toBeGreaterThan(2));

    expect(progress(run).stage).toBe("confirming");
    expect(sendCallsOf(requests)).toHaveLength(1);
  });

  it.each(FAILED)("status %i: halts as batch-failed, holding nothing", async (code) => {
    const world = newWorld();
    const { run, requests, storage } = polled(world, () => Promise.resolve({ status: code }));

    run.start();
    await settled(run);

    expect(progress(run).failure).toEqual({ reason: "batch-failed", retryable: false });
    expect(progress(run).holdsSend).toBeUndefined();
    expect(stored(storage)?.callsId).toBeUndefined();
    expect(sendCallsOf(requests)).toHaveLength(1);
  });

  it("error 5730: halts as batch-unknown, keeping the batch id", async () => {
    const world = newWorld();
    const { run, requests, storage, id } = polled(world, () => Promise.reject(UNKNOWN_BUNDLE));

    run.start();
    await settled(run);

    expect(progress(run).failure).toEqual({ reason: "batch-unknown", retryable: false });
    expect(progress(run).holdsSend).toBe(true);
    expect(stored(storage)?.callsId).toBe(id());
    expect(sendCallsOf(requests)).toHaveLength(1);
  });

  it("another error: stops keeping the batch id, and a retry sends no second batch", async () => {
    const world = newWorld();
    const { run, requests, storage, id } = polled(world, () => Promise.reject(INTERNAL));

    run.start();
    await settled(run);

    expect(progress(run).stage).toBe("halted");
    expect(progress(run).holdsSend).toBe(true);
    expect(stored(storage)?.callsId).toBe(id());
    run.retry();
    await tick();
    expect(sendCallsOf(requests)).toHaveLength(1);
  });
});

describe("createRedeemRun's discard reads a stored batch's status by EIP-5792 v2", () => {
  it.each([...PENDING, ...LANDED])("status %i: refuses as pending, keeping the stored run", async (code) => {
    const world = newWorld();
    const { left, id } = await storedBatch(world);
    const { run, requests } = await reloaded(world, left, id, status(code));

    await run.discard();

    expect(progress(run).failure).toEqual({ reason: "pending", retryable: true });
    expect(stored(left)?.callsId).toBe(id);
    expect(sendCallsOf(requests)).toEqual([]);
  });

  it.each(FAILED)("status %i: lets go of the run", async (code) => {
    const world = newWorld();
    const { left, id } = await storedBatch(world);
    const { run, requests } = await reloaded(world, left, id, status(code));

    await run.discard();

    expect(progress(run)).toEqual({ stage: "idle" });
    expect(stored(left)).toBeNull();
    expect(sendCallsOf(requests)).toEqual([]);
  });

  it("error 5730, with no send of the account broadcast: lets go of the run", async () => {
    const world = newWorld();
    const { left, id } = await storedBatch(world);
    const { run } = await reloaded(world, left, id, () => Promise.reject(UNKNOWN_BUNDLE));

    await run.discard();

    expect(progress(run)).toEqual({ stage: "idle" });
    expect(stored(left)).toBeNull();
  });

  it("another error: halts with a retry, keeping the stored run", async () => {
    const world = newWorld();
    const { left, id } = await storedBatch(world);
    const { run, requests } = await reloaded(world, left, id, () => Promise.reject(INTERNAL));

    await run.discard();

    expect(progress(run).stage).toBe("halted");
    expect(progress(run).failure?.retryable).toBe(true);
    expect(stored(left)?.callsId).toBe(id);
    expect(sendCallsOf(requests)).toEqual([]);
  });
});
