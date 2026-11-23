import { encodeFunctionData, erc20Abi, maxUint256 } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import { planWalletRedeem } from "../plan";
import { INPUT, newWorld, PLANNED, progress, runs, settled, stored, tab } from "./support/tabs";

vi.mock("../plan", async (importOriginal) => {
  const original = await importOriginal<typeof import("../plan")>();
  return { ...original, planWalletRedeem: vi.fn(original.planWalletRedeem) };
});

afterEach(() => {
  for (const run of runs.splice(0)) run.dispose();
  vi.mocked(planWalletRedeem).mockRestore();
});

/** The plan with its first approve made unbounded, as a planner fault would. */
function unboundedFirstApprove() {
  const real = planWalletRedeem(INPUT);
  const [spender] = [PLANNED[2]!.to];
  const tampered = {
    ...real,
    calls: [
      {
        to: PLANNED[0]!.to,
        data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, maxUint256] }),
      },
      ...real.calls.slice(1),
    ],
  };
  vi.mocked(planWalletRedeem).mockReturnValue(tampered);
}

describe("createRedeemRun R8 sends nothing that departs from the allow-list", () => {
  it("one by one: stops as unlisted, with no prompt and no stored send", async () => {
    unboundedFirstApprove();
    const world = newWorld();
    const { run, sends, storage } = tab(world);

    run.start();
    await settled(run);

    expect(progress(run).failure).toEqual({ reason: "unlisted", retryable: false });
    expect(sends.prompts).toEqual([]);
    expect(stored(storage)).toBeNull();
  });

  it("atomic: stops as unlisted, with no batch sent and no stored batch id", async () => {
    const world = newWorld();
    const { run, batch, storage } = tab(world, { atomic: true });
    unboundedFirstApprove();

    run.start();
    await settled(run);

    expect(progress(run).failure).toEqual({ reason: "unlisted", retryable: false });
    expect(batch.sendCalls).toEqual([]);
    expect(stored(storage)?.callsId).toBeUndefined();
  });
});
