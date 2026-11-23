import type { FlowTx } from "@foresight/tx-orchestrator";
import { isAddressEqual } from "viem";
import { afterEach, describe, expect, it } from "vitest";

import { newWorld, PLANNED, progress, reached, REDEEM_AT, runs, settled, tab, type World } from "./support/tabs";

afterEach(() => {
  for (const run of runs.splice(0)) run.dispose();
});

const AT = REDEEM_AT[0]!;
const sameTx = (a: FlowTx, b: FlowTx) => isAddressEqual(a.to, b.to) && (a.data ?? "0x") === (b.data ?? "0x");

/** How many times each planned call mined and did not revert. */
const landed = (world: World) =>
  PLANNED.map(
    (tx) =>
      world.fake.broadcasts.filter((sent) => sent.mined && !world.reverts.has(sent.hash) && sameTx(sent.tx, tx)).length,
  );

describe("createRedeemRun after a send the wallet cancelled (ported from liquidity driver.unanswered)", () => {
  it("asks again on retry for the cancelled call, and lands it once", async () => {
    const world = newWorld();
    const { run, sends } = tab(world, { script: (index) => (index === AT ? "unmined" : "sign") });
    const wait = sends.port.waitForReceipt;
    let cancelled = false;
    sends.port.waitForReceipt = (args) => {
      const sent = world.fake.find(args.hash)!;
      if (cancelled || !sameTx(sent.tx, PLANNED[AT]!)) return wait(args);
      cancelled = true;
      // a zero-value self-send took the nonce: the call never ran
      world.reverts.add(sent.hash);
      world.fake.land();
      args.onReplaced?.({ reason: "cancelled", hash: sent.hash });
      return Promise.resolve(world.fake.receiptOf(sent));
    };

    run.start();
    await settled(run);
    expect(progress(run).failure?.reason).toBe("cancelled");

    run.retry();
    await reached(run, "complete");

    expect(landed(world)).toEqual(PLANNED.map(() => 1));
  });
});
