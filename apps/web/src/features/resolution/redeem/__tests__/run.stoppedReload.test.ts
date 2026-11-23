import { afterEach, describe, expect, it, vi } from "vitest";

import { newWorld, PLANNED, progress, recovered, REDEEM_AT, runs, settled, tab, tick } from "./support/tabs";
import { copyStorage } from "./support/world";

afterEach(() => {
  for (const run of runs.splice(0)) run.dispose();
});

const AT = REDEEM_AT[0]!;

describe("createRedeemRun reloading a run stopped as changed (R6)", () => {
  it("shows it stopped for a new review, and resume signs nothing while the balance still differs", async () => {
    const world = newWorld();
    const first = tab(world, {
      script: (index) => {
        if (index === AT - 1) world.extra.set(PLANNED[AT - 2]!.to.toLowerCase(), 1n);
        return "sign";
      },
    });
    first.run.start();
    await vi.waitFor(() => expect(progress(first.run).failure?.reason).toBe("changed"));
    const left = copyStorage(first.storage);
    first.run.dispose();

    const next = await recovered(world, left);
    const shown = progress(next.run);
    next.run.resume();
    await settled(next.run);
    next.run.retry();
    await tick();

    expect(shown).toEqual({ stage: "review" });
    expect(progress(next.run)).toEqual({ stage: "halted", failure: { reason: "changed", retryable: false } });
    expect(next.sends.prompts).toEqual([]);
  });
});
