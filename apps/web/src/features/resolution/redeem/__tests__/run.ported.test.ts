import { createMemoryStorage, type FlowRunStorage, type FlowTx } from "@foresight/tx-orchestrator";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  callOf,
  newWorld,
  OTHER,
  OWNER,
  PLANNED,
  progress,
  reached,
  recovered,
  REDEEM_AT,
  runs,
  settled,
  tab,
  tick,
  type World,
} from "./support/tabs";
import { copyStorage, timesBroadcast } from "./support/world";

afterEach(() => {
  for (const run of runs.splice(0)) run.dispose();
});

/** Ported from liquidity `driver.unanswered`, `driver.sequential`, `driver.atomic` and `driver.progress` tests. */

const AT = REDEEM_AT[0]!;

async function leftOpen(world: World) {
  const first = tab(world, { script: (index) => (index === AT ? "hang" : "sign") });
  first.run.start();
  await first.sends.held();
  const left = copyStorage(first.storage);
  first.run.dispose();
  return { left, hung: first.sends.hung[0]! };
}

async function reopened(world: World, left: FlowRunStorage, opts: Parameters<typeof tab>[1] = {}) {
  const next = await recovered(world, left, opts);
  if (progress(next.run).stage === "review") next.run.resume();
  await settled(next.run);
  return next;
}

const record = (storage: FlowRunStorage) => {
  const raw = storage.keys().map((key) => storage.getItem(key)!);
  return raw.length === 0
    ? null
    : (JSON.parse(raw[0]!) as { adapterId: string; steps: { outcome: { status: string } }[] });
};

describe("createRedeemRun recovering a prompt open when its tab closed (L8)", () => {
  const nearCalls: [string, (hung: FlowTx) => FlowTx][] = [
    ["its target with other calldata", (hung) => ({ ...hung, data: `${hung.data ?? "0x"}00` })],
    ["its target and calldata with other value", (hung) => ({ ...hung, value: (hung.value ?? 0n) + 1n })],
    ["its calldata to another target", (hung) => ({ ...hung, to: OTHER })],
  ];

  it.each(nearCalls)(
    "halts needing the visitor, signing nothing, when a call to %s took its nonce",
    async (_, near) => {
      const world = newWorld();
      const { left, hung } = await leftOpen(world);
      world.fake.broadcast(near(hung), OWNER, true);

      const { run, sends } = await reopened(world, left);

      expect(progress(run).failure).toEqual({ reason: "held", retryable: true });
      expect(sends.prompts).toEqual([]);
      expect(timesBroadcast(world.fake, [hung])).toEqual([0]);
    },
  );

  it("halts as pending, signing nothing, when the call approved after the tab closed has no receipt to read yet", async () => {
    const world = newWorld();
    const { left, hung } = await leftOpen(world);
    const approved = world.fake.approveLater(hung, OWNER);
    const next = tab(world, { storage: left });
    const read = next.sends.port.getReceipt;
    next.sends.port.getReceipt = (hash) => (hash === approved.hash ? Promise.resolve(null) : read(hash));
    next.run.recover();
    await reached(next.run, "review");

    next.run.resume();
    await settled(next.run);

    expect(progress(next.run).failure).toEqual({ reason: "pending", retryable: true });
    expect(next.sends.prompts).toEqual([]);
  });

  it("halts as pending, signing nothing, when the prompt's send is broadcast after the account read as having none", async () => {
    const world = newWorld();
    const { left, hung } = await leftOpen(world);
    world.fake.broadcast(hung, OWNER, false);

    // the node's pending count lags the transaction it already serves
    const { run, sends } = await reopened(world, left, { reader: { hasPending: () => Promise.resolve(false) } });

    expect(progress(run).failure).toEqual({ reason: "pending", retryable: true });
    expect(sends.prompts).toEqual([]);
  });

  it("holds a send stored with only a nonce and a time, whose nonce a mined call of it took", async () => {
    const world = newWorld();
    const { left, hung } = await leftOpen(world);
    for (const key of left.keys()) {
      const stored = JSON.parse(left.getItem(key)!) as { snapshot: { sends: Record<string, { nonce: number }> } };
      stored.snapshot.sends = Object.fromEntries(
        Object.entries(stored.snapshot.sends).map(([id, send]) => [id, { nonce: send.nonce, heldAt: 1 }]),
      ) as never;
      left.setItem(key, JSON.stringify(stored));
    }
    world.fake.approveLater(hung, OWNER);

    const { run, sends } = await reopened(world, left);

    expect(progress(run).failure).toEqual({ reason: "held", retryable: true });
    expect(sends.prompts).toEqual([]);
  });

  it("sends the held redeem once when its prompt was approved after the tab closed and mined only before a retry", async () => {
    const world = newWorld();
    const { left, hung } = await leftOpen(world);
    world.fake.broadcast(hung, OWNER, false);

    const { run, sends } = await reopened(world, left);
    expect(progress(run).failure).toEqual({ reason: "pending", retryable: true });
    world.fake.land();
    run.retry();
    await reached(run, "complete");

    expect(sends.prompts.map(callOf)).toEqual(PLANNED.slice(AT + 1).map(callOf));
    expect(timesBroadcast(world.fake, PLANNED)).toEqual(PLANNED.map(() => 1));
  });
});

describe("createRedeemRun running a plan one call at a time", () => {
  it("stores the run under the redeem-flow adapter", async () => {
    const world = newWorld();
    const { run, sends, storage } = tab(world, { script: () => "hang" });

    run.start();
    await sends.held();

    expect(record(storage)?.adapterId).toBe("redeem-flow");
  });

  it("has every send stored before the wallet is asked for it", async () => {
    const world = newWorld();
    const seen: { stored: boolean; awaiting: number; held: number }[] = [];
    const storage = createMemoryStorage();
    const { run } = tab(world, {
      storage,
      script: () => {
        const steps = record(storage)?.steps ?? [];
        seen.push({
          stored: record(storage) !== null,
          awaiting: steps.filter((step) => step.outcome.status === "awaiting-signature").length,
          held: steps.filter((step) => step.outcome.status !== "pending" && step.outcome.status !== "skipped").length,
        });
        return "sign";
      },
    });

    run.start();
    await reached(run, "complete");

    // at the n-th prompt the n earlier sends are banked and this one is stored as asked for
    expect(seen).toEqual(PLANNED.map((_, n) => ({ stored: true, awaiting: 1, held: n + 1 })));
  });
});

describe("createRedeemRun with a wallet that does not batch atomically on Gnosis", () => {
  const fallbacks: [string, (method: string) => Promise<unknown> | undefined][] = [
    [
      "reports atomic unsupported",
      (method) =>
        method === "wallet_getCapabilities"
          ? Promise.resolve({ "0x64": { atomic: { status: "unsupported" } } })
          : undefined,
    ],
    [
      "reports no atomic capability",
      (method) => (method === "wallet_getCapabilities" ? Promise.resolve({ "0x64": {} }) : undefined),
    ],
    [
      "does not answer wallet_getCapabilities",
      (method) =>
        method === "wallet_getCapabilities"
          ? Promise.reject(Object.assign(new Error("Method not found"), { code: -32601 }))
          : undefined,
    ],
  ];

  it.each(fallbacks)("signs one call at a time when the wallet %s", async (_, answer) => {
    const world = newWorld();
    const { run, sends, requests } = tab(world, { atomic: true, answer });

    run.start();
    await reached(run, "complete");

    expect(requests.filter((each) => each.method === "wallet_sendCalls")).toEqual([]);
    expect(sends.prompts.map(callOf)).toEqual(PLANNED.map(callOf));
  });
});

describe("createRedeemRun never sends a batch again after a reload (L9)", () => {
  it.each([
    ["pending", (id: string) => Promise.resolve({ id, status: 100 })],
    ["unknown", () => Promise.reject(Object.assign(new Error("Unknown bundle id"), { code: 5730 }))],
  ] as const)("when the wallet reports its status as %s, whatever is pressed", async (_, status) => {
    const world = newWorld();
    const first = tab(world, {
      atomic: true,
      answer: (method) => (method === "wallet_sendCalls" ? new Promise(() => {}) : undefined),
    });
    first.run.start();
    await vi.waitFor(() => expect(first.requests.some((each) => each.method === "wallet_sendCalls")).toBe(true));
    await tick();
    const left = copyStorage(first.storage);
    first.run.dispose();

    const next = tab(world, {
      storage: left,
      atomic: true,
      answer: (method, params) => (method === "wallet_getCallsStatus" ? status((params as [string])[0]) : undefined),
    });
    next.run.recover();
    await settled(next.run);
    next.run.resume();
    await tick();
    next.run.retry();
    next.run.start();
    await tick();

    expect(next.requests.filter((each) => each.method === "wallet_sendCalls")).toEqual([]);
    expect(next.sends.prompts).toEqual([]);
    expect(progress(next.run).stage).not.toBe("complete");
  });
});

describe("createRedeemRun's progress", () => {
  it("says it confirms once a call's transaction is broadcast, and moves on once it mines", async () => {
    const world = newWorld();
    const { run, sends } = tab(world, { script: (index) => (index === 0 ? "unmined" : "sign") });

    run.start();
    await vi.waitFor(() => expect(sends.prompts).toHaveLength(1));
    await reached(run, "confirming");
    world.fake.land();

    await reached(run, "complete");
  });

  it("atomic: says the batch is confirming once the wallet takes it", async () => {
    const world = newWorld();
    const { run, batch } = tab(world, { atomic: true, sendCalls: "unmined" });

    run.start();
    await batch.sent();
    await reached(run, "confirming");
    expect(progress(run).atomic).toBe(true);
    world.fake.land();

    await reached(run, "complete");
  });

  it("never says the wallet asks while it checks what the stored run left on chain", async () => {
    const world = newWorld();
    const { left } = await leftOpen(world);
    const stages: string[] = [];
    const next = tab(world, { storage: left });
    next.run.subscribe(() => stages.push(progress(next.run).stage));

    next.run.recover();
    await reached(next.run, "review");

    expect(stages).not.toContain("signing");
  });
});
