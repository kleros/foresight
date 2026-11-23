import { afterEach, describe, expect, it, vi } from "vitest";

import { planWalletRedeem } from "../plan";
import { redeemCallsDepartures } from "../tradeWalletBatchAllowed";
import { INPUT, newWorld, progress, runs, settled, stored, tab } from "./support/tabs";

vi.mock("../plan", async (importOriginal) => {
  const original = await importOriginal<typeof import("../plan")>();
  return { ...original, planWalletRedeem: vi.fn(original.planWalletRedeem) };
});

afterEach(() => {
  for (const run of runs.splice(0)) run.dispose();
  vi.mocked(planWalletRedeem).mockRestore();
});

/** The plan with native value on its first approve: one departure, nothing else changed. */
function valueOnFirstCall() {
  const real = planWalletRedeem(INPUT);
  const tampered = { ...real, calls: [{ ...real.calls[0]!, value: 1n }, ...real.calls.slice(1)] };
  vi.mocked(planWalletRedeem).mockReturnValue(tampered);
  return tampered;
}

describe("createRedeemRun R8 stops on a single departing call", () => {
  it("has exactly one departure in the tampered plan", () => {
    const { calls } = valueOnFirstCall();
    const children = { 0: INPUT.resolution.children[0], 1: INPUT.resolution.children[1] } as const;
    const scope = {
      collateral: INPUT.collateral,
      parentMarket: INPUT.parentMarket,
      parentTokens: INPUT.parentTokens.map((each) => each.token),
      children: Object.fromEntries(
        Object.entries(INPUT.childTokens).map(([key, holdings]) => [
          Number(key),
          {
            market: (children[Number(key) as 0 | 1] as { market: `0x${string}` }).market,
            tokens: holdings!.map((h) => h.token),
          },
        ]),
      ),
    };
    expect(redeemCallsDepartures({ calls, chainId: INPUT.chainId, scope })).toHaveLength(1);
  });

  it.each([false, true])("stops as unlisted, asking the wallet nothing (atomic: %s)", async (atomic) => {
    const world = newWorld();
    const { run, sends, requests, storage } = tab(world, { atomic });
    valueOnFirstCall();

    run.start();
    await settled(run);

    expect(progress(run).failure).toEqual({ reason: "unlisted", retryable: false });
    expect(sends.prompts).toEqual([]);
    expect(requests.filter((each) => each.method === "wallet_sendCalls")).toEqual([]);
    expect(stored(storage)).toBeNull();
  });
});
