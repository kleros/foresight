import { createMemoryStorage, type FlowTx } from "@foresight/tx-orchestrator";
import type { Address, Hash } from "viem";
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

/** Ported from liquidity `driver.discard.test.ts` and `driver.recoveryOwner.test.ts`. */

const AT = REDEEM_AT[0]!;
const nextHash = (world: World): Hash => `0x${(world.fake.broadcasts.length + 1).toString(16).padStart(64, "0")}`;
const sameTx = (a: FlowTx, b: FlowTx) => a.to === b.to && (a.data ?? "0x") === (b.data ?? "0x");

async function leftOpen(world: World, stuck = AT) {
  const first = tab(world, { script: (index) => (index === stuck ? "hang" : "sign") });
  first.run.start();
  await first.sends.held();
  const left = copyStorage(first.storage);
  first.run.dispose();
  return { left, hung: first.sends.hung[0]! };
}

async function reopened(world: World, left: ReturnType<typeof createMemoryStorage>) {
  const next = await recovered(world, left);
  if (progress(next.run).stage === "review") next.run.resume();
  await settled(next.run);
  return next;
}

/** A tab whose redeem at AT is broadcast unmined and whose receipt wait for it fails, `times` times. */
function receiptWaitFails(world: World, times = 1, opts: { hasPending?: () => boolean } = {}) {
  const opened = tab(world, {
    script: (index) => (index === AT ? "unmined" : "sign"),
    ...(opts.hasPending ? { reader: { hasPending: () => Promise.resolve(opts.hasPending!()) } } : {}),
  });
  const wait = opened.sends.port.waitForReceipt;
  let failed = 0;
  opened.sends.port.waitForReceipt = (args) => {
    if (failed >= times || !sameTx(world.fake.find(args.hash)!.tx, PLANNED[AT]!)) return wait(args);
    failed += 1;
    return Promise.reject(new Error("boom"));
  };
  return opened;
}

describe("createRedeemRun discard", () => {
  it("keeps the settled steps of a run halted as reverted, and resume asks again for the reverted call", async () => {
    const world = newWorld();
    let reverted = false;
    const { run, storage } = tab(world, {
      script: (index) => {
        if (index === AT && !reverted) {
          reverted = true;
          world.reverts.add(nextHash(world));
        }
        return "sign";
      },
    });
    run.start();
    await vi.waitFor(() => expect(progress(run).failure?.reason).toBe("reverted"));

    await run.discard();

    expect(progress(run)).toEqual({ stage: "review" });
    expect(stored(storage)).not.toBeNull();
    run.resume();
    await reached(run, "complete");
    expect(timesBroadcast(world.fake, PLANNED)).toEqual(PLANNED.map((_, index) => (index === AT ? 2 : 1)));
  });

  it("keeps the settled steps of a run stopped as changed (R6), for a new review", async () => {
    const world = newWorld();
    const { run, storage } = tab(world, {
      script: (index) => {
        if (index === AT - 1) world.extra.set(PLANNED[AT - 2]!.to.toLowerCase(), 1n);
        return "sign";
      },
    });
    run.start();
    await vi.waitFor(() => expect(progress(run).failure?.reason).toBe("changed"));

    await run.discard();

    expect(progress(run)).toEqual({ stage: "review" });
    expect(stored(storage)?.sends).toEqual(["call:0", "call:1"]);
  });

  it("forgets a run stopped as changed (R6) before anything was signed", async () => {
    const world = newWorld();
    world.extra.set(PLANNED[0]!.to.toLowerCase(), 1n);
    const { run, sends, storage } = tab(world);
    run.start();
    await vi.waitFor(() => expect(progress(run).failure?.reason).toBe("changed"));

    await run.discard();

    expect(progress(run)).toEqual({ stage: "idle" });
    expect(stored(storage)).toBeNull();
    expect(sends.prompts).toEqual([]);
  });

  it("keeps a run whose send was broadcast before its receipt wait failed, and that send lands once", async () => {
    const world = newWorld();
    const { run, storage } = receiptWaitFails(world);
    run.start();
    await reached(run, "halted");

    await run.discard();

    expect(stored(storage)).not.toBeNull();
    expect(progress(run).failure).toEqual({ reason: "pending", retryable: true });
    world.fake.land();
    run.retry();
    await reached(run, "complete");
    expect(timesBroadcast(world.fake, PLANNED)).toEqual(PLANNED.map(() => 1));
  });

  it("keeps a run whose submitted send has no receipt while the node reports nothing pending", async () => {
    const world = newWorld();
    let mempool = true;
    const { run, storage } = receiptWaitFails(world, Infinity, {
      hasPending: () => mempool && world.fake.broadcasts.some((sent) => !sent.mined),
    });
    run.start();
    await reached(run, "halted");
    // a node that never saw the transaction in its mempool
    mempool = false;

    await run.discard();

    expect(stored(storage)).not.toBeNull();
    expect(progress(run).failure).toEqual({ reason: "pending", retryable: true });
  });

  it("keeps a run whose submitted send mined after its receipt wait failed, and that send lands once", async () => {
    const world = newWorld();
    const { run, storage } = receiptWaitFails(world);
    run.start();
    await reached(run, "halted");
    world.fake.land();

    await run.discard();

    expect(stored(storage)).not.toBeNull();
    expect(progress(run).failure).toEqual({ reason: "pending", retryable: true });
    run.retry();
    await reached(run, "complete");
    expect(timesBroadcast(world.fake, PLANNED)).toEqual(PLANNED.map(() => 1));
  });

  it("keeps a run, halted as rpc, when the chain cannot be read to tell whether its send landed", async () => {
    const world = newWorld();
    let mempool = true;
    const { run, sends, storage } = receiptWaitFails(world, Infinity, {
      hasPending: () => mempool && world.fake.broadcasts.some((sent) => !sent.mined),
    });
    run.start();
    await reached(run, "halted");
    mempool = false;
    sends.port.getReceipt = () => Promise.reject(new Error("request timed out"));

    await run.discard();

    expect(stored(storage)).not.toBeNull();
    expect(progress(run).failure?.reason).toBe("rpc");
  });

  // liquidity reads the receipt first and halts as rpc; the redeem run reads the account's pending sends first
  it("keeps a run, as pending, when its send is broadcast and the chain cannot be read for its receipt", async () => {
    const world = newWorld();
    const { run, sends, storage } = receiptWaitFails(world, Infinity);
    run.start();
    await reached(run, "halted");
    sends.port.getReceipt = () => Promise.reject(new Error("request timed out"));

    await run.discard();

    expect(stored(storage)).not.toBeNull();
    expect(progress(run).failure).toEqual({ reason: "pending", retryable: true });
  });

  it("keeps a run whose send broadcast at a later nonce than the stored one, after another send took that nonce", async () => {
    const world = newWorld();
    const { left, hung } = await leftOpen(world);
    const { run } = await reopened(world, left);
    expect(progress(run).failure?.reason).toBe("held");
    world.fake.broadcast({ to: OTHER, data: "0x" }, OWNER, true);
    world.fake.broadcast(hung, OWNER, false);

    await run.discard();

    expect(stored(left)).not.toBeNull();
    expect(progress(run).failure).toEqual({ reason: "pending", retryable: true });
  });

  it("keeps a run held on a prompt that was approved and mined since it halted, and that send lands once", async () => {
    const world = newWorld();
    const { left, hung } = await leftOpen(world);
    const { run } = await reopened(world, left);
    expect(progress(run).failure?.reason).toBe("held");
    world.fake.approveLater(hung, OWNER);

    await run.discard();

    expect(stored(left)).not.toBeNull();
    expect(progress(run).failure).toEqual({ reason: "pending", retryable: true });
    run.retry();
    await reached(run, "complete");
    expect(timesBroadcast(world.fake, PLANNED)).toEqual(PLANNED.map(() => 1));
  });

  it("atomic: keeps a run whose batch the wallet reports confirmed after a status read failed, and sends it once", async () => {
    const world = newWorld();
    let failed = false;
    const { run, batch, storage } = tab(world, {
      atomic: true,
      answer: (method) =>
        method === "wallet_getCallsStatus" && !failed
          ? ((failed = true), Promise.reject(new Error("request timed out")))
          : undefined,
    });
    run.start();
    await reached(run, "halted");

    await run.discard();

    expect(stored(storage)).not.toBeNull();
    expect(progress(run).failure).toEqual({ reason: "pending", retryable: true });
    run.retry();
    await reached(run, "complete");
    expect(batch.sendCalls).toHaveLength(1);
  });

  it("atomic: keeps a run whose batch the wallet reports pending after a status read failed", async () => {
    const world = newWorld();
    let failed = false;
    const { run, storage } = tab(world, {
      atomic: true,
      sendCalls: "unmined",
      answer: (method) =>
        method === "wallet_getCallsStatus" && !failed
          ? ((failed = true), Promise.reject(new Error("request timed out")))
          : undefined,
    });
    run.start();
    await reached(run, "halted");

    await run.discard();

    expect(stored(storage)).not.toBeNull();
    expect(progress(run).failure?.reason).toBe("pending");
  });
});

describe("createRedeemRun discard and reset, where they differ from liquidity on purpose", () => {
  // liquidity keeps a run under review on discard; the redeem run lets go of its held send there too
  it("lets go of the held send of a run under review, keeping its settled calls, and resume signs the rest once", async () => {
    const world = newWorld();
    const { left } = await leftOpen(world);
    const { run, sends } = await recovered(world, left);
    expect(progress(run).stage).toBe("review");

    await run.discard();

    expect(progress(run)).toEqual({ stage: "review" });
    expect(stored(left)?.sends).toEqual(["call:0", "call:1"]);
    run.resume();
    await reached(run, "complete");
    expect(sends.prompts.map(callOf)).toEqual(PLANNED.slice(AT).map(callOf));
    expect(timesBroadcast(world.fake, PLANNED)).toEqual(PLANNED.map(() => 1));
  });

  // liquidity's reset keeps a run reverted on its first step; the redeem run forgets the reverted send
  it("reset forgets a run halted as reverted with no call settled, and sends nothing", async () => {
    const world = newWorld();
    let reverted = false;
    const { run, sends, storage } = tab(world, {
      script: (index) => {
        if (index === 0 && !reverted) {
          reverted = true;
          world.reverts.add(nextHash(world));
        }
        return "sign";
      },
    });
    run.start();
    await vi.waitFor(() => expect(progress(run).failure?.reason).toBe("reverted"));
    const before = sends.prompts.length;

    run.reset();
    await tick();

    expect(progress(run)).toEqual({ stage: "idle" });
    expect(stored(storage)).toBeNull();
    expect(sends.prompts).toHaveLength(before);
  });
});

const others: [string, Address | undefined][] = [
  ["another account", OTHER],
  ["no account", undefined],
];

describe("createRedeemRun recovering a run the owner left (L4)", () => {
  it.each(others)("prompts for nothing while %s is connected", async (_, account) => {
    const world = newWorld();
    const { left } = await leftOpen(world);
    const next = tab(world, { storage: left, account, atomic: true });

    next.run.recover();
    await settled(next.run);
    next.run.resume();
    next.run.retry();
    next.run.start();
    await tick();

    expect(next.sends.prompts).toEqual([]);
    expect(next.requests.filter((each) => each.method === "wallet_sendCalls")).toEqual([]);
  });

  it.each(others)("halts as the wrong wallet and keeps the owner's run while %s is connected", async (_, account) => {
    const world = newWorld();
    const { left } = await leftOpen(world);
    const before = stored(left);
    const next = tab(world, { storage: left, account });

    next.run.recover();
    await reached(next.run, "halted");

    expect(progress(next.run).failure?.reason).toBe("wrong-wallet");
    expect(stored(left)).toEqual(before);
  });

  it("finishes the owner's run, sending nothing twice, once the owner reconnects in another letter case", async () => {
    const world = newWorld();
    const { left, hung } = await leftOpen(world);
    world.fake.approveLater(hung, OWNER);
    const next = tab(world, { storage: left, account: OWNER.toUpperCase().replace("0X", "0x") as Address });

    next.run.recover();
    await reached(next.run, "review");
    next.run.resume();
    await reached(next.run, "complete");

    expect(timesBroadcast(world.fake, PLANNED)).toEqual(PLANNED.map(() => 1));
  });
});
