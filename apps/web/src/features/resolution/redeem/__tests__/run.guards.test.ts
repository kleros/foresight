import { afterEach, describe, expect, it, vi } from "vitest";

import {
  callOf,
  newWorld,
  OTHER,
  OWNER,
  PLANNED,
  progress,
  REDEEM_AT,
  refusingStorage,
  runs,
  settled,
  stored,
  tab,
} from "./support/tabs";
import { timesBroadcast } from "./support/world";

afterEach(() => {
  for (const run of runs.splice(0)) run.dispose();
  vi.restoreAllMocks();
});

const coded = (code: number) => Object.assign(new Error("The wallet does not support this request."), { code });

describe("createRedeemRun asks the wallet as the connected account, on the request's chain", () => {
  it("sends wallet_sendCalls from the connected account", async () => {
    const world = newWorld();
    const { run, batch } = tab(world, { atomic: true });

    run.start();
    await settled(run);

    expect(progress(run).stage).toBe("complete");
    expect(batch.sendCalls).toHaveLength(1);
    expect(batch.sendCalls[0]!.from).toBe(OWNER);
  });

  it('sends one atomic batch when the wallet reports atomic "ready"', async () => {
    const world = newWorld();
    const { run, sends, batch } = tab(world, {
      answer: (method) =>
        method === "wallet_getCapabilities" ? Promise.resolve({ "0x64": { atomic: { status: "ready" } } }) : undefined,
    });

    run.start();
    await settled(run);

    expect(progress(run).stage).toBe("complete");
    expect(sends.prompts).toEqual([]);
    expect(batch.sendCalls).toHaveLength(1);
  });

  it("signs one by one when the wallet reports atomic batching for another chain only", async () => {
    const world = newWorld();
    const { run, sends, batch } = tab(world, {
      answer: (method) =>
        method === "wallet_getCapabilities"
          ? Promise.resolve({ "0x1": { atomic: { status: "supported" } } })
          : undefined,
    });

    run.start();
    await settled(run);

    expect(sends.prompts.map(callOf)).toEqual(PLANNED.map(callOf));
    expect(batch.sendCalls).toEqual([]);
  });

  it("stops as wrong-chain, asking nothing, while the wallet is on another chain", async () => {
    const world = newWorld();
    const { run, sends, requests } = tab(world, { chainId: 1 });

    run.start();
    await settled(run);

    expect(progress(run)).toEqual({ stage: "halted", failure: { reason: "wrong-chain", retryable: true } });
    expect(sends.prompts).toEqual([]);
    expect(requests).toEqual([]);
  });

  it("stops as wrong-wallet, asking nothing, while another account than the request's is connected", async () => {
    const world = newWorld();
    const { run, sends } = tab(world, { account: OTHER });

    run.start();
    await settled(run);

    expect(progress(run)).toEqual({ stage: "halted", failure: { reason: "wrong-wallet", retryable: true } });
    expect(sends.prompts).toEqual([]);
  });

  it("does not restore another account's stored run", async () => {
    const world = newWorld();
    const first = tab(world, { script: (index) => (index === 1 ? "hang" : "sign") });
    first.run.start();
    await first.sends.held();
    first.run.dispose();

    const next = tab(world, { storage: first.storage, account: OTHER });
    next.run.recover();

    expect(progress(next.run)).toEqual({ stage: "halted", failure: { reason: "wrong-wallet", retryable: true } });
    next.run.resume();
    next.run.start();
    await settled(next.run);
    expect(next.sends.prompts).toEqual([]);
    expect(stored(first.storage)?.sends).toEqual(["call:0", "call:1"]);
  });
});

describe("createRedeemRun stores each send before the wallet opens", () => {
  it("stops as pending, asking nothing, while the account has a send not yet mined", async () => {
    const world = newWorld();
    world.fake.broadcast({ to: OTHER, data: "0x" }, OWNER, false);
    const { run, sends } = tab(world);

    run.start();
    await settled(run);

    expect(progress(run).failure).toEqual({ reason: "pending", retryable: true });
    expect(sends.prompts).toEqual([]);

    world.fake.land();
    run.retry();
    await vi.waitFor(() => expect(progress(run).stage).toBe("complete"), { timeout: 3_000 });
    expect(timesBroadcast(world.fake, PLANNED)).toEqual(PLANNED.map(() => 1));
  });

  it("one by one: a send that cannot be stored opens no prompt and leaves no send behind, and the retry signs it once", async () => {
    const world = newWorld();
    const { storage, refusing } = refusingStorage('"sends":{"call:0"');
    const { run, sends } = tab(world, { storage });

    run.start();
    await settled(run);

    expect(progress(run)).toEqual({ stage: "halted", failure: { reason: "storage", retryable: true } });
    expect(sends.prompts).toEqual([]);
    expect(refusing.refused).toBeGreaterThan(0);

    refusing.on = false;
    run.retry();
    await vi.waitFor(() => expect(progress(run).stage).toBe("complete"), { timeout: 3_000 });
    expect(sends.prompts.map(callOf)).toEqual(PLANNED.map(callOf));
    expect(timesBroadcast(world.fake, PLANNED)).toEqual(PLANNED.map(() => 1));
  });

  it("atomic: a batch id that cannot be stored sends no batch and leaves no id behind, and the retry sends it once", async () => {
    const world = newWorld();
    const { storage, refusing } = refusingStorage('"callsId"');
    const { run, batch } = tab(world, { atomic: true, storage });

    run.start();
    await settled(run);

    expect(progress(run)).toEqual({
      stage: "halted",
      failure: { reason: "storage", retryable: true },
      atomic: true,
    });
    expect(batch.sendCalls).toEqual([]);

    refusing.on = false;
    run.retry();
    await vi.waitFor(() => expect(progress(run).stage).toBe("complete"), { timeout: 3_000 });
    expect(batch.sendCalls).toHaveLength(1);
  });
});

describe("createRedeemRun lets go of a send the wallet answered without a prompt", () => {
  it.each([4100, 4200, -32601, 5700])(
    "one by one: code %i halts as wallet, and the retry asks for that call once",
    async (code) => {
      const world = newWorld();
      const { run, sends, storage } = tab(world, {
        sendError: (index) => (index === REDEEM_AT[0] ? coded(code) : undefined),
      });

      run.start();
      await settled(run);

      expect(progress(run).failure).toEqual({ reason: "wallet", retryable: true });
      expect(stored(storage)?.sends).not.toContain(`call:${REDEEM_AT[0]}`);

      run.retry();
      await vi.waitFor(() => expect(progress(run).stage).toBe("complete"), { timeout: 3_000 });
      expect(timesBroadcast(world.fake, PLANNED)).toEqual(PLANNED.map(() => 1));
      expect(sends.prompts.map(callOf)).toEqual(PLANNED.map(callOf));
    },
  );

  it("one by one: a disconnect (4900) keeps the send, since the wallet may have signed", async () => {
    const world = newWorld();
    const { run, storage } = tab(world, { sendError: (index) => (index === 0 ? coded(4900) : undefined) });

    run.start();
    await settled(run);

    expect(progress(run).stage).toBe("halted");
    expect(progress(run).holdsSend).toBe(true);
    expect(stored(storage)?.sends).toEqual(["call:0"]);
  });

  it("atomic: code 5700 halts as batch-refused, and the retry signs each call one by one, once", async () => {
    const world = newWorld();
    const { run, batch, sends } = tab(world, { atomic: true, sendCallsRefuse: 5700 });

    run.start();
    await settled(run);
    expect(progress(run).failure).toEqual({ reason: "batch-refused", retryable: true });

    run.retry();
    await vi.waitFor(() => expect(progress(run).stage).toBe("complete"), { timeout: 3_000 });
    expect(batch.sendCalls).toHaveLength(1);
    expect(sends.prompts.map(callOf)).toEqual(PLANNED.map(callOf));
    expect(timesBroadcast(world.fake, PLANNED)).toEqual(PLANNED.map(() => 1));
  });
});

describe("createRedeemRun R6 signs only the balances the section showed", () => {
  it("stops before an approve whose token's balance changed since the review", async () => {
    const world = newWorld();
    const { run, sends } = tab(world, {
      script: (index) => {
        if (index === 0) world.extra.set(PLANNED[1]!.to.toLowerCase(), 1n);
        return "sign";
      },
    });

    run.start();
    await settled(run);

    expect(progress(run)).toEqual({ stage: "halted", failure: { reason: "changed", retryable: false } });
    expect(sends.prompts).toHaveLength(1);
  });

  it("stops before a redeem when any token it pulls changed since the review, not only the last approved", async () => {
    const world = newWorld();
    const redeem = REDEEM_AT[0]!;
    const { run, sends } = tab(world, {
      script: (index) => {
        // the first approve of the part, after its own build read it
        if (index === redeem - 1) world.extra.set(PLANNED[redeem - 2]!.to.toLowerCase(), 1n);
        return "sign";
      },
    });

    run.start();
    await settled(run);

    expect(progress(run).failure).toEqual({ reason: "changed", retryable: false });
    expect(sends.prompts.map(callOf)).toEqual(PLANNED.slice(0, redeem).map(callOf));
  });

  it("atomic: sends no batch when any token of it changed since the review", async () => {
    const world = newWorld();
    world.extra.set(PLANNED[REDEEM_AT[2]! - 1]!.to.toLowerCase(), 5n);
    const { run, batch } = tab(world, { atomic: true });

    run.start();
    await settled(run);

    expect(progress(run).failure).toEqual({ reason: "changed", retryable: false });
    expect(batch.sendCalls).toEqual([]);
  });

  it("a stopped run that holds no send is forgotten by reset, and the next press reads the request again", async () => {
    const world = newWorld();
    world.extra.set(PLANNED[0]!.to.toLowerCase(), 1n);
    const { run, sends, storage } = tab(world);
    run.start();
    await settled(run);
    expect(progress(run).holdsSend).toBeUndefined();

    run.reset();

    expect(progress(run)).toEqual({ stage: "idle" });
    expect(stored(storage)).toBeNull();
    world.extra.clear();
    run.start();
    await vi.waitFor(() => expect(progress(run).stage).toBe("complete"), { timeout: 3_000 });
    expect(sends.prompts.map(callOf)).toEqual(PLANNED.map(callOf));
  });
});
