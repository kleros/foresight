import { getAddress } from "viem";
import { afterEach, describe, expect, it } from "vitest";

import type { WalletRedeemInput } from "../plan";
import { callOf, INPUT, newWorld, PLANNED, progress, reached, runs, settled, tab } from "./support/tabs";
import { timesBroadcast } from "./support/world";

afterEach(() => {
  for (const run of runs.splice(0)) run.dispose();
});

const EMPTY: WalletRedeemInput = {
  ...INPUT,
  parentTokens: INPUT.parentTokens.map((holding) => ({ ...holding, balance: 0n })),
  childTokens: Object.fromEntries(
    Object.entries(INPUT.childTokens).map(([key, holdings]) => [
      key,
      holdings!.map((holding) => ({ ...holding, balance: 0n })),
    ]),
  ),
};

describe("createRedeemRun on a request with nothing to redeem", () => {
  it.each([false, true])("halts as unknown, asking the wallet nothing (atomic: %s)", async (atomic) => {
    const world = newWorld();
    const { run, sends, requests } = tab(world, { atomic, request: EMPTY });

    run.start();
    await settled(run);

    expect(progress(run).failure).toEqual({ reason: "unknown", retryable: false });
    expect(sends.prompts).toEqual([]);
    expect(requests.filter((each) => each.method === "wallet_sendCalls")).toEqual([]);
  });
});

describe("createRedeemRun on a request that holds tokens of a child market not deployed", () => {
  const UNDEPLOYED: WalletRedeemInput = {
    ...INPUT,
    resolution: { ...INPUT.resolution, children: { ...INPUT.resolution.children, 2: { deployed: false } } },
    childTokens: { ...INPUT.childTokens, 2: [{ token: getAddress(`0x${"d2".padEnd(40, "0")}`), balance: 5n }] },
  };

  it.each([false, true])("redeems the deployed parts once, as planned (atomic: %s)", async (atomic) => {
    const world = newWorld();
    const { run, sends, batch } = tab(world, { atomic, request: UNDEPLOYED });

    run.start();
    await reached(run, "complete");

    if (atomic) expect(batch.sendCalls.map((each) => each.calls.map(callOf))).toEqual([PLANNED.map(callOf)]);
    else {
      expect(sends.prompts.map(callOf)).toEqual(PLANNED.map(callOf));
      expect(timesBroadcast(world.fake, PLANNED)).toEqual(PLANNED.map(() => 1));
    }
  });
});
