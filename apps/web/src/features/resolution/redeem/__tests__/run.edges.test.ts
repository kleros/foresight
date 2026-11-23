import { createFlowRunStore, createMemoryStorage } from "@foresight/tx-orchestrator";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  newWorld,
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

const FIRST_REDEEM = REDEEM_AT[0]!;

async function leftOpen(world: World, stuck: number) {
  const first = tab(world, { script: (index) => (index === stuck ? "hang" : "sign") });
  first.run.start();
  await first.sends.held();
  const left = copyStorage(first.storage);
  first.run.dispose();
  return left;
}

describe("createRedeemRun restores and discards a run only on the chain it started on", () => {
  it("stops as wrong-chain, restoring nothing, while the wallet is on another chain", async () => {
    const world = newWorld();
    const left = await leftOpen(world, FIRST_REDEEM);
    const next = tab(world, { storage: left, chainId: 1 });

    next.run.recover();

    expect(progress(next.run)).toEqual({ stage: "halted", failure: { reason: "wrong-chain", retryable: true } });
  });

  it("keeps a held run on discard while the wallet is on another chain", async () => {
    const world = newWorld();
    const left = await leftOpen(world, FIRST_REDEEM);
    const next = tab(world, { storage: left, chainId: 1 });
    next.run.recover();

    await next.run.discard();

    expect(progress(next.run).failure).toEqual({ reason: "wrong-chain", retryable: true });
    expect(stored(left)?.sends).toContain(`call:${FIRST_REDEEM}`);
  });
});

describe("createRedeemRun after a run completed", () => {
  it("a second press reads the request again rather than doing nothing", async () => {
    const world = newWorld();
    const { run, sends } = tab(world);
    run.start();
    await reached(run, "complete");
    const prompts = sends.prompts.length;

    run.start();
    await settled(run);

    // the request still shows the balances the first run redeemed
    expect(progress(run).failure).toEqual({ reason: "changed", retryable: false });
    expect(sends.prompts).toHaveLength(prompts);
  });
});

describe("createRedeemRun across two tabs", () => {
  it("of two tabs pressing Redeem at once, the one that did not start rests in review", async () => {
    const world = newWorld();
    const storage = createMemoryStorage();
    const a = tab(world, { storage, script: () => "hang" });
    const b = tab(world, { storage, script: () => "hang" });

    a.run.start();
    b.run.start();
    await vi.waitFor(() => expect(a.sends.prompts.length + b.sends.prompts.length).toBe(1));
    await tick();

    const idle = a.sends.prompts.length === 0 ? a : b;
    expect(progress(idle.run).stage).toBe("review");
  });

  it("a tab that completes after another tab took the run over leaves that tab's stored run in place", async () => {
    const world = newWorld();
    const storage = createMemoryStorage();
    const last = PLANNED.length - 1;
    let other: ReturnType<typeof tab> | undefined;
    const a = tab(world, {
      storage,
      script: (index) => {
        if (index === last) {
          other = tab(world, { storage });
          other.run.recover();
        }
        return "sign";
      },
    });

    a.run.start();
    await reached(a.run, "complete");
    await reached(other!.run, "review");
    expect(stored(storage)).not.toBeNull();
    other!.run.resume();
    await settled(other!.run);

    expect(progress(other!.run).stage).toBe("complete");
    expect(other!.sends.prompts).toEqual([]);
  });

  it("a discard whose probe another tab outran loads the run again, keeping that tab's send", async () => {
    const world = newWorld();
    const left = await leftOpen(world, FIRST_REDEEM);
    let raced = false;
    const next = await recovered(world, left, {
      reader: {
        hasPending: async () => {
          if (!raced) {
            raced = true;
            // another tab stores a send for the last call while this one probes the chain
            const other = createFlowRunStore({ storage: left, now: () => Date.now() + 1 });
            const record = other.load<{ sends: Record<string, unknown> }, unknown>("redeem-session-4")!;
            other.save({
              ...record,
              snapshot: { ...record.snapshot, sends: { ...record.snapshot.sends, "call:8": {} } },
            });
          }
          return false;
        },
      },
    });
    expect(progress(next.run).stage).toBe("review");

    await next.run.discard();
    await settled(next.run);

    expect(progress(next.run).stage).toBe("review");
    expect(stored(left)?.sends).toContain("call:8");
    expect(stored(left)?.sends).toContain(`call:${FIRST_REDEEM}`);
  });
});
