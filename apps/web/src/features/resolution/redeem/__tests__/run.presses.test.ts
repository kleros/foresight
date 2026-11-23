import type { FlowRunStorage } from "@foresight/tx-orchestrator";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
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
import { copyStorage } from "./support/world";

afterEach(() => {
  for (const run of runs.splice(0)) run.dispose();
});

const AT = REDEEM_AT[0]!;
const nothingPending = { hasPending: () => Promise.resolve(false) };

async function leftOpen(world: World) {
  const first = tab(world, { script: (index) => (index === AT ? "hang" : "sign") });
  first.run.start();
  await first.sends.held();
  const left = copyStorage(first.storage);
  first.run.dispose();
  return { left, hung: first.sends.hung[0]! };
}

/** A stored run halted as rejected on its first call: it holds no send. */
async function rejectedFirst(world: World) {
  const first = tab(world, { script: (index) => (index === 0 ? "reject" : "sign") });
  first.run.start();
  await settled(first.run);
  expect(progress(first.run).failure?.reason).toBe("rejected");
  const left = copyStorage(first.storage);
  first.run.dispose();
  return left;
}

describe("createRedeemRun reads the account's pending sends before matching a stored one", () => {
  it("stops as pending, not held, while a send of the account is broadcast at a later nonce", async () => {
    const world = newWorld();
    const { left, hung } = await leftOpen(world);
    world.fake.broadcast({ to: OTHER, data: "0x" }, OWNER, true);
    world.fake.broadcast(hung, OWNER, false);

    const next = await recovered(world, left);
    next.run.resume();
    await settled(next.run);

    expect(progress(next.run).failure).toEqual({ reason: "pending", retryable: true });
    expect(next.sends.prompts).toEqual([]);
  });
});

describe("createRedeemRun's progress while a run is running", () => {
  it("names no held send while a prompt is open", async () => {
    const world = newWorld();
    const { run, sends } = tab(world, { script: () => "hang" });

    run.start();
    await sends.held();

    expect(progress(run)).toEqual({ stage: "signing" });
  });
});

describe("createRedeemRun ignores presses that do not apply", () => {
  it("stores and signs nothing when disposed while it reads the wallet's capabilities", async () => {
    const world = newWorld();
    let answer: (value: unknown) => void = () => {};
    const { run, sends, storage } = tab(world, {
      answer: (method) =>
        method === "wallet_getCapabilities" ? new Promise((resolve) => (answer = resolve)) : undefined,
    });

    run.start();
    await vi.waitFor(() => expect(progress(run).stage).toBe("signing"));
    run.dispose();
    answer({ "0x64": {} });
    await tick();

    expect(stored(storage)).toBeNull();
    expect(sends.prompts).toEqual([]);
  });

  it("opens no second prompt when Redeem or recovery is pressed while a prompt is open", async () => {
    const world = newWorld();
    const { run, sends } = tab(world, { script: () => "hang" });
    run.start();
    await sends.held();

    run.start();
    run.recover();
    run.resume();
    await tick();

    expect(sends.prompts).toHaveLength(1);
    expect(progress(run).stage).toBe("signing");
  });

  it("signs nothing on resume while the run is halted, not under review", async () => {
    const world = newWorld();
    const { run, sends } = tab(world, { script: (index) => (index === 0 ? "reject" : "sign") });
    run.start();
    await settled(run);
    expect(progress(run).failure?.reason).toBe("rejected");

    run.resume();
    await tick();

    expect(sends.prompts).toHaveLength(1);
    expect(progress(run).failure?.reason).toBe("rejected");
  });

  it("signs nothing on resume after a reload that found the stored send reverted", async () => {
    const world = newWorld();
    const first = tab(world, { script: (index) => (index === AT ? "unmined" : "sign") });
    first.run.start();
    await vi.waitFor(() => expect(first.sends.prompts).toHaveLength(AT + 1));
    await tick();
    const left = copyStorage(first.storage);
    first.run.dispose();
    world.reverts.add(world.fake.broadcasts[AT]!.hash);
    world.fake.land();

    const next = await recovered(world, left);
    expect(progress(next.run).failure?.reason).toBe("reverted");
    next.run.resume();
    await tick();

    expect(progress(next.run).failure?.reason).toBe("reverted");
    expect(next.sends.prompts).toEqual([]);
  });

  it("discards a reload that found the stored send reverted, and resume asks for that call again", async () => {
    const world = newWorld();
    const first = tab(world, { script: (index) => (index === AT ? "unmined" : "sign") });
    first.run.start();
    await vi.waitFor(() => expect(first.sends.prompts).toHaveLength(AT + 1));
    await tick();
    const left = copyStorage(first.storage);
    first.run.dispose();
    const hash = world.fake.broadcasts[AT]!.hash;
    world.reverts.add(hash);
    world.fake.land();
    const next = await recovered(world, left);
    expect(progress(next.run).failure?.reason).toBe("reverted");

    await next.run.discard();
    expect(progress(next.run)).toEqual({ stage: "review" });
    next.run.resume();
    await reached(next.run, "complete");

    expect(next.sends.prompts).toHaveLength(PLANNED.length - AT);
  });

  it("leaves the stored run alone when discard is pressed on a completed run", async () => {
    const world = newWorld();
    const { run, storage } = tab(world);
    run.start();
    await reached(run, "complete");
    const before = stored(storage);

    await run.discard();

    expect(progress(run)).toEqual({ stage: "complete" });
    expect(stored(storage)).toEqual(before);
  });
});

describe("createRedeemRun keeps another account's stored run that holds no send", () => {
  it.each(["start", "reset"] as const)("on %s", async (press) => {
    const world = newWorld();
    const left: FlowRunStorage = await rejectedFirst(world);
    const before = stored(left);
    const next = tab(world, { storage: left, account: OTHER });

    next.run[press]();
    await tick();

    expect(stored(left)).toEqual(before);
    expect(next.sends.prompts).toEqual([]);
  });
});

describe("createRedeemRun's discard while the node's pending count lags", () => {
  it("keeps a held send the chain shows pending at its nonce", async () => {
    const world = newWorld();
    const { left, hung } = await leftOpen(world);
    const next = await recovered(world, left, { reader: nothingPending });
    world.fake.broadcast(hung, OWNER, false);

    await next.run.discard();

    expect(progress(next.run).failure).toEqual({ reason: "pending", retryable: true });
    expect(stored(left)?.sends).toContain(`call:${AT}`);
  });

  it("keeps a held send that mined with no receipt to read yet", async () => {
    const world = newWorld();
    const { left, hung } = await leftOpen(world);
    const next = await recovered(world, left, { reader: nothingPending });
    const approved = world.fake.approveLater(hung, OWNER);
    const read = next.sends.port.getReceipt;
    next.sends.port.getReceipt = (hash) => (hash === approved.hash ? Promise.resolve(null) : read(hash));

    await next.run.discard();

    expect(progress(next.run).failure).toEqual({ reason: "pending", retryable: true });
    expect(stored(left)?.sends).toContain(`call:${AT}`);
  });

  it("keeps a submitted send with no receipt that the chain shows no send of at its nonce", async () => {
    const world = newWorld();
    const { run, sends, storage } = tab(world, {
      script: (index) => (index === AT ? "unmined" : "sign"),
      reader: { ...nothingPending, sentWithNonce: () => Promise.resolve({ status: "none" }) },
    });
    const wait = sends.port.waitForReceipt;
    sends.port.waitForReceipt = (args) =>
      args.hash === world.fake.broadcasts[AT]?.hash ? Promise.reject(new Error("boom")) : wait(args);
    run.start();
    await reached(run, "halted");

    await run.discard();

    expect(progress(run).failure).toEqual({ reason: "pending", retryable: true });
    expect(stored(storage)).not.toBeNull();
  });
});
