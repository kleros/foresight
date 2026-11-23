import { createMemoryStorage, type FlowTx } from "@foresight/tx-orchestrator";
import type { Hash } from "viem";
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
  stored,
  tab,
  tick,
  type World,
} from "./support/tabs";
import { copyStorage, timesBroadcast } from "./support/world";

afterEach(() => {
  for (const run of runs.splice(0)) run.dispose();
});

const FIRST_REDEEM = REDEEM_AT[0]!;
const REDEEMS = PLANNED.filter((_, index) => REDEEM_AT.includes(index));

/** The hash the fake chain gives its next broadcast. */
const nextHash = (world: World): Hash => `0x${(world.fake.broadcasts.length + 1).toString(16).padStart(64, "0")}`;

/** A one-by-one run whose prompt `stuck` was open, unanswered, when its tab closed. */
async function leftOpen(world: World, stuck: number) {
  const first = tab(world, { script: (index) => (index === stuck ? "hang" : "sign") });
  first.run.start();
  await first.sends.held();
  const left = copyStorage(first.storage);
  first.run.dispose();
  return { left, hung: first.sends.hung[0]! };
}

/** A tab on `left`, recovered and resumed until it rests. */
async function resumed(world: World, left: ReturnType<typeof createMemoryStorage>, opts: { atomic?: boolean } = {}) {
  const next = await recovered(world, left, opts);
  expect(progress(next.run).stage).toBe("review");
  next.run.resume();
  await settled(next.run);
  return next;
}

describe("createRedeemRun matches a stored send only to the call it stored", () => {
  it("stops as held, signing nothing, when another transaction took the stored send's nonce", async () => {
    const world = newWorld();
    const { left, hung } = await leftOpen(world, FIRST_REDEEM);
    world.fake.approveLater({ to: OTHER, data: "0x" }, OWNER);

    const { run, sends } = await resumed(world, left);

    expect(progress(run).failure).toEqual({ reason: "held", retryable: true });
    expect(sends.prompts).toEqual([]);
    expect(timesBroadcast(world.fake, [hung])).toEqual([0]);
  });

  it("stops as held when another call to the same router took the stored send's nonce", async () => {
    const world = newWorld();
    const { left, hung } = await leftOpen(world, FIRST_REDEEM);
    world.fake.approveLater({ to: hung.to, data: `0x${hung.data!.slice(2, -2)}00` }, OWNER);

    const { run, sends } = await resumed(world, left);

    expect(progress(run).failure).toEqual({ reason: "held", retryable: true });
    expect(sends.prompts).toEqual([]);
  });

  it("halts as reverted, holding nothing, when the stored send mined and reverted, and the next press signs a new run", async () => {
    const world = newWorld();
    const { left, hung } = await leftOpen(world, FIRST_REDEEM);
    world.reverts.add(nextHash(world));
    world.fake.approveLater(hung, OWNER);

    const { run, sends, storage } = await resumed(world, left);

    expect(progress(run)).toEqual({ stage: "halted", failure: { reason: "reverted", retryable: false } });
    expect(sends.prompts).toEqual([]);

    run.start();
    await reached(run, "complete");
    expect(sends.prompts.map(callOf)).toEqual(PLANNED.map(callOf));
    expect(stored(storage)).toBeNull();
  });
});

describe("createRedeemRun lets a run that cannot land again start over", () => {
  it("one by one: a redeem that reverts halts holding nothing, and Redeem signs a new run", async () => {
    const world = newWorld();
    let reverted = false;
    const { run, sends } = tab(world, {
      script: (index) => {
        if (index === FIRST_REDEEM && !reverted) {
          reverted = true;
          world.reverts.add(nextHash(world));
        }
        return "sign";
      },
    });

    run.start();
    await settled(run);
    expect(progress(run)).toEqual({ stage: "halted", failure: { reason: "reverted", retryable: false } });
    const before = sends.prompts.length;

    run.start();
    await reached(run, "complete");

    expect(sends.prompts.slice(before).map(callOf)).toEqual(PLANNED.map(callOf));
  });

  it("one by one: after a reload, Redeem on a reverted run signs a new run", async () => {
    const world = newWorld();
    const first = tab(world, {
      script: (index) => {
        if (index === FIRST_REDEEM) world.reverts.add(nextHash(world));
        return "sign";
      },
    });
    first.run.start();
    await settled(first.run);
    const left = copyStorage(first.storage);
    first.run.dispose();

    const next = await recovered(world, left);
    next.run.start();
    await reached(next.run, "complete");

    expect(next.sends.prompts.map(callOf)).toEqual(PLANNED.map(callOf));
  });

  it("atomic: a batch the wallet reports failed halts holding nothing, and Redeem sends a new batch", async () => {
    const world = newWorld();
    let failed: string | undefined;
    const { run, batch } = tab(world, {
      atomic: true,
      // the first batch is taken and reported failed, with nothing broadcast
      answer: (method, params) => {
        if (method === "wallet_sendCalls" && failed === undefined) {
          failed = (params as [{ id: string }])[0].id;
          return Promise.resolve({ id: failed });
        }
        const [id] = params as [string];
        return method === "wallet_getCallsStatus" && id === failed
          ? Promise.resolve({ status: 400, atomic: true })
          : undefined;
      },
    });

    run.start();
    await settled(run);
    expect(progress(run).failure).toEqual({ reason: "batch-failed", retryable: false });
    expect(progress(run).holdsSend).toBeUndefined();

    run.start();
    await reached(run, "complete");
    expect(batch.sendCalls).toHaveLength(1);
    expect(batch.sendCalls[0]!.id).not.toBe(failed);
  });
});

describe("createRedeemRun never asks again for a send that may still land", () => {
  it("goes back to review, signing nothing, when Redeem is pressed on a held run", async () => {
    const world = newWorld();
    const { left, hung } = await leftOpen(world, FIRST_REDEEM);
    const { run, sends } = await resumed(world, left);
    expect(progress(run).failure?.reason).toBe("held");

    run.start();
    await settled(run);

    expect(progress(run).stage).toBe("review");
    expect(sends.prompts).toEqual([]);
    expect(timesBroadcast(world.fake, [hung])).toEqual([0]);
  });

  it("a fresh tab's Redeem on a stored held run goes to review and signs nothing", async () => {
    const world = newWorld();
    const { left } = await leftOpen(world, FIRST_REDEEM);
    const next = tab(world, { storage: left });

    next.run.start();
    await settled(next.run);

    expect(progress(next.run).stage).toBe("review");
    expect(progress(next.run).holdsSend).toBe(true);
    expect(next.sends.prompts).toEqual([]);
  });

  it("atomic: stops as pending, sending no second batch, while the stored batch has not landed", async () => {
    const world = newWorld();
    const first = tab(world, { atomic: true, sendCalls: "unmined" });
    first.run.start();
    await first.batch.sent();
    const left = copyStorage(first.storage);
    first.run.dispose();

    const { run, batch } = await resumed(world, left, { atomic: true });

    expect(progress(run).failure).toEqual({ reason: "pending", retryable: true });
    expect(batch.sendCalls).toEqual([]);

    world.fake.land();
    run.retry();
    await reached(run, "complete");
    expect(first.batch.sendCalls.length + batch.sendCalls.length).toBe(1);
  });

  it("reset keeps a run that holds a send", async () => {
    const world = newWorld();
    const { left } = await leftOpen(world, FIRST_REDEEM);
    const { run } = await resumed(world, left);

    run.reset();

    expect(progress(run).failure?.reason).toBe("held");
    expect(stored(left)?.sends).toEqual(["call:0", "call:1", `call:${FIRST_REDEEM}`]);
  });
});

describe("createRedeemRun discard lets go of a held send once the chain shows it cannot land", () => {
  it("keeps the approves of a run held on its redeem, and resume asks for the redeem and the rest once", async () => {
    const world = newWorld();
    const { left } = await leftOpen(world, FIRST_REDEEM);
    const { run, sends } = await resumed(world, left);
    expect(progress(run)).toEqual({ stage: "halted", failure: { reason: "held", retryable: true }, holdsSend: true });

    await run.discard();

    expect(progress(run)).toEqual({ stage: "review" });
    expect(stored(left)?.sends).toEqual(["call:0", "call:1"]);
    run.resume();
    await reached(run, "complete");
    expect(sends.prompts.map(callOf)).toEqual(PLANNED.slice(FIRST_REDEEM).map(callOf));
    expect(timesBroadcast(world.fake, PLANNED)).toEqual(PLANNED.map(() => 1));
  });

  it("lets go of a redeem whose nonce another transaction took", async () => {
    const world = newWorld();
    const { left } = await leftOpen(world, FIRST_REDEEM);
    world.fake.approveLater({ to: OTHER, data: "0x" }, OWNER);
    const { run } = await resumed(world, left);

    await run.discard();
    run.resume();
    await reached(run, "complete");

    expect(timesBroadcast(world.fake, REDEEMS)).toEqual(REDEEMS.map(() => 1));
  });

  it("forgets a run held on its first prompt, and the next Redeem signs every call once", async () => {
    const world = newWorld();
    const { left } = await leftOpen(world, 0);
    const { run } = await resumed(world, left);

    await run.discard();

    expect(progress(run)).toEqual({ stage: "idle" });
    expect(stored(left)).toBeNull();
    run.start();
    await reached(run, "complete");
    expect(timesBroadcast(world.fake, PLANNED)).toEqual(PLANNED.map(() => 1));
  });

  it("refuses, as pending, while the held send is broadcast, and the retry settles it without signing it again", async () => {
    const world = newWorld();
    const { left, hung } = await leftOpen(world, FIRST_REDEEM);
    const { run, sends } = await resumed(world, left);
    world.fake.broadcast(hung, OWNER, false);

    await run.discard();

    expect(progress(run).failure).toEqual({ reason: "pending", retryable: true });
    expect(stored(left)?.sends).toContain(`call:${FIRST_REDEEM}`);
    world.fake.land();
    run.retry();
    await reached(run, "complete");
    expect(sends.prompts.map(callOf)).toEqual(PLANNED.slice(FIRST_REDEEM + 1).map(callOf));
    expect(timesBroadcast(world.fake, [hung])).toEqual([1]);
  });

  it("refuses, as pending, a run under review whose held send has mined since, and resume settles it unsigned", async () => {
    const world = newWorld();
    const { left, hung } = await leftOpen(world, FIRST_REDEEM);
    const { run, sends } = await recovered(world, left);
    world.fake.approveLater(hung, OWNER);

    await run.discard();

    expect(progress(run).failure).toEqual({ reason: "pending", retryable: true });
    run.retry();
    await reached(run, "complete");
    expect(sends.prompts.map(callOf)).toEqual(PLANNED.slice(FIRST_REDEEM + 1).map(callOf));
    expect(timesBroadcast(world.fake, [hung])).toEqual([1]);
  });

  it("atomic: lets go of a batch the wallet cannot report once no send of the account is broadcast", async () => {
    const world = newWorld();
    let asked = false;
    const first = tab(world, {
      atomic: true,
      answer: (method) => (method === "wallet_sendCalls" ? ((asked = true), new Promise(() => {})) : undefined),
    });
    first.run.start();
    await vi.waitFor(() => expect(asked).toBe(true));
    const left = copyStorage(first.storage);
    first.run.dispose();
    expect(stored(left)?.callsId).toBeDefined();

    const { run, requests } = await resumed(world, left, { atomic: true });
    expect(progress(run)).toEqual({
      stage: "halted",
      failure: { reason: "batch-unknown", retryable: false },
      holdsSend: true,
      atomic: true,
    });

    await run.discard();

    expect(progress(run)).toEqual({ stage: "idle" });
    expect(stored(left)).toBeNull();
    run.start();
    await reached(run, "complete");
    expect(requests.filter((each) => each.method === "wallet_sendCalls")).toHaveLength(1);
  });

  it("atomic: keeps a batch the wallet cannot report while a send of the account is broadcast", async () => {
    const world = newWorld();
    const first = tab(world, {
      atomic: true,
      answer: (method) => (method === "wallet_sendCalls" ? new Promise(() => {}) : undefined),
    });
    first.run.start();
    await vi.waitFor(() => expect(stored(first.storage)?.callsId).toBeDefined());
    await tick();
    const left = copyStorage(first.storage);
    first.run.dispose();
    const { run, requests } = await resumed(world, left, { atomic: true });
    world.fake.broadcast({ to: OWNER, data: "0x" }, OWNER, false);

    await run.discard();

    expect(progress(run).failure).toEqual({ reason: "pending", retryable: true });
    expect(stored(left)?.callsId).toBeDefined();
    expect(requests.filter((each) => each.method === "wallet_sendCalls")).toEqual([]);
  });

  it("atomic: keeps a run whose batch is still pending", async () => {
    const world = newWorld();
    const first = tab(world, { atomic: true, sendCalls: "unmined" });
    first.run.start();
    await first.batch.sent();
    const left = copyStorage(first.storage);
    first.run.dispose();
    const { run, batch } = await resumed(world, left, { atomic: true });

    await run.discard();

    expect(progress(run).failure).toEqual({ reason: "pending", retryable: true });
    expect(batch.sendCalls).toEqual([]);
    expect(stored(left)?.callsId).toBeDefined();
  });

  it("keeps a run while another account is connected", async () => {
    const world = newWorld();
    const { left } = await leftOpen(world, FIRST_REDEEM);
    const next = tab(world, { storage: left, account: OTHER });
    next.run.recover();

    await next.run.discard();

    expect(progress(next.run).failure).toEqual({ reason: "wrong-wallet", retryable: true });
    expect(stored(left)?.sends).toContain(`call:${FIRST_REDEEM}`);
  });
});

describe("createRedeemRun across two live tabs on one storage", () => {
  /** A run rejected at its first redeem, left in `storage`. */
  async function rejectedRun(world: World, opts: { atomic?: boolean } = {}) {
    const storage = createMemoryStorage();
    const first = tab(world, {
      storage,
      ...(opts.atomic
        ? { atomic: true, sendCallsRefuse: 4001 }
        : { script: (index: number) => (index === FIRST_REDEEM ? "reject" : "sign") }),
    });
    first.run.start();
    await settled(first.run);
    expect(progress(first.run).failure?.reason).toBe("rejected");
    first.run.dispose();
    return storage;
  }

  const same = (tx: FlowTx) => (sent: FlowTx) => callOf(sent).data === callOf(tx).data;

  it("one by one: the second tab to resume asks nothing while the first tab's prompt is open", async () => {
    const world = newWorld();
    const storage = await rejectedRun(world);
    const a = tab(world, { storage, script: () => "hang" });
    const b = tab(world, { storage });
    a.run.recover();
    b.run.recover();
    await reached(a.run, "review");
    await reached(b.run, "review");

    a.run.resume();
    await a.sends.held();
    b.run.resume();
    await settled(b.run);
    if (progress(b.run).stage === "review") {
      b.run.resume();
      await settled(b.run);
    }

    expect(b.sends.prompts).toEqual([]);
    const redeem = PLANNED[FIRST_REDEEM]!;
    expect([...a.sends.prompts, ...b.sends.prompts].filter(same(redeem))).toHaveLength(1);
    expect(progress(b.run).stage).toBe("halted");
  });

  it("one by one: two tabs pressing Redeem at once open one prompt between them", async () => {
    const world = newWorld();
    const storage = createMemoryStorage();
    const a = tab(world, { storage, script: () => "hang" });
    const b = tab(world, { storage, script: () => "hang" });

    a.run.start();
    b.run.start();
    await vi.waitFor(() => expect(a.sends.prompts.length + b.sends.prompts.length).toBe(1));
    await tick();

    expect(a.sends.prompts.length + b.sends.prompts.length).toBe(1);
  });

  it("atomic: the second tab to resume sends no batch while the first tab's batch request is open", async () => {
    const world = newWorld();
    const storage = await rejectedRun(world, { atomic: true });
    let asked = false;
    const a = tab(world, {
      storage,
      atomic: true,
      answer: (method) => (method === "wallet_sendCalls" ? ((asked = true), new Promise(() => {})) : undefined),
    });
    const b = tab(world, { storage, atomic: true });
    a.run.recover();
    b.run.recover();
    await reached(a.run, "review");
    await reached(b.run, "review");

    a.run.resume();
    await vi.waitFor(() => expect(asked).toBe(true));
    b.run.resume();
    await settled(b.run);
    if (progress(b.run).stage === "review") {
      b.run.resume();
      await settled(b.run);
    }

    expect(b.requests.filter((each) => each.method === "wallet_sendCalls")).toEqual([]);
    expect(b.batch.sendCalls).toEqual([]);
    expect(progress(b.run).stage).toBe("halted");
  });

  it("a tab resumed after another tab moved the run on loads it again for review, asking nothing", async () => {
    const world = newWorld();
    const storage = await rejectedRun(world);
    const a = tab(world, { storage, script: () => "hang" });
    const b = tab(world, { storage });
    a.run.recover();
    b.run.recover();
    await reached(a.run, "review");
    await reached(b.run, "review");
    a.run.resume();
    await a.sends.held();

    b.run.resume();
    await settled(b.run);

    expect(progress(b.run)).toEqual({ stage: "review", holdsSend: true });
    expect(b.sends.prompts).toEqual([]);
  });

  it("a tab whose stored run another tab changed stops as elsewhere before its next prompt", async () => {
    const world = newWorld();
    const storage = createMemoryStorage();
    let other: ReturnType<typeof tab> | undefined;
    const a = tab(world, {
      storage,
      script: (index) => {
        // while A's first prompt is open, B takes the run over and moves it on
        if (index === 0) {
          other = tab(world, { storage, script: () => "hang" });
          other.run.recover();
        }
        return "sign";
      },
    });

    a.run.start();
    await vi.waitFor(() => expect(progress(a.run).failure?.reason).toBe("elsewhere"), { timeout: 3_000 });

    expect(a.sends.prompts).toHaveLength(1);
    expect(progress(other!.run).stage).toBe("review");
    other!.run.resume();
    await other!.sends.held();
    expect(other!.sends.prompts.map(callOf)).toEqual([callOf(PLANNED[1]!)]);
  });
});
