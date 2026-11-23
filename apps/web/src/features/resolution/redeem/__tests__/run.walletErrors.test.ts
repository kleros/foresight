import { afterEach, describe, expect, it, vi } from "vitest";

import {
  callOf,
  newWorld,
  OWNER,
  PLANNED,
  progress,
  reached,
  REDEEM_AT,
  runs,
  settled,
  stored,
  tab,
} from "./support/tabs";
import { timesBroadcast } from "./support/world";

afterEach(() => {
  for (const run of runs.splice(0)) run.dispose();
});

/** Ported from liquidity `driver.walletErrors.test.ts`, the redeem run's twin of each case. */

const AT = REDEEM_AT[0]!;
const coded = (code: number, message = "The wallet refused the request.") =>
  Object.assign(new Error(message), { code });
const sendCallsOf = <T extends { method: string }>(requests: T[]) =>
  requests.filter((each) => each.method === "wallet_sendCalls");

describe("createRedeemRun when the wallet answers a prompt with an error", () => {
  it.each([4100, 4200, -32601, -32602, 3])(
    "lets go of a send answered with %i, which opens no prompt, so Try again asks again, each call once",
    async (code) => {
      const world = newWorld();
      const { run, sends, storage } = tab(world, { sendError: (index) => (index === AT ? coded(code) : undefined) });
      run.start();
      await settled(run);

      expect(progress(run).failure).toEqual({ reason: "wallet", retryable: true });
      expect(progress(run).holdsSend).toBeUndefined();
      expect(stored(storage)?.sends).toHaveLength(AT);

      run.retry();
      await reached(run, "complete");
      expect(sends.prompts.map(callOf)).toEqual(PLANNED.map(callOf));
      expect(timesBroadcast(world.fake, PLANNED)).toEqual(PLANNED.map(() => 1));
    },
  );

  it.each([-32603, 4900, 4901])(
    "keeps a send answered with %i, which may follow a signature, and asks for nothing again",
    async (code) => {
      const world = newWorld();
      const { run, sends } = tab(world, { sendError: (index) => (index === AT ? coded(code) : undefined) });
      run.start();
      await settled(run);
      expect(progress(run).stage).toBe("halted");
      expect(progress(run).holdsSend).toBe(true);
      const asked = sends.prompts.length;

      if (progress(run).failure?.retryable) {
        run.retry();
        await vi.waitFor(() => expect(progress(run).failure?.reason).toBe("held"));
      }

      expect(progress(run).failure?.reason).not.toBe("wallet");
      expect(sends.prompts).toHaveLength(asked);
    },
  );

  it("keeps a send whose wallet error only reads as a rejection, so a call that broadcast is not sent again", async () => {
    const world = newWorld();
    const { run } = tab(world, {
      sendError: (index) =>
        index === AT
          ? (world.fake.broadcast(PLANNED[AT]!, OWNER, true), new Error("User rejected the request."))
          : undefined,
    });
    run.start();
    await settled(run);
    expect(progress(run).stage).toBe("halted");
    expect(progress(run).holdsSend).toBe(true);

    run.retry();
    await reached(run, "complete");

    expect(timesBroadcast(world.fake, PLANNED)).toEqual(PLANNED.map(() => 1));
  });

  it("asks again for a send WalletConnect declined with 5000, however the decline is worded", async () => {
    const world = newWorld();
    const { run } = tab(world, { sendError: (index) => (index === AT ? coded(5000, "x") : undefined) });
    run.start();
    await settled(run);
    expect(progress(run).failure).toEqual({ reason: "rejected", retryable: true });
    expect(progress(run).holdsSend).toBeUndefined();

    run.retry();
    await reached(run, "complete");
    expect(timesBroadcast(world.fake, PLANNED)).toEqual(PLANNED.map(() => 1));
  });

  it("reads a code-3 revert from the chain while building as no wallet answer", async () => {
    const world = newWorld();
    let reads = 0;
    const { run } = tab(world, {
      reader: {
        blockNumber: () => {
          reads += 1;
          return reads === 3
            ? Promise.reject(new Error("read failed", { cause: coded(3, "execution reverted") }))
            : Promise.resolve(world.fake.state.block);
        },
      },
    });
    run.start();
    await settled(run);

    expect(progress(run).stage).toBe("halted");
    expect(progress(run).failure?.reason).not.toBe("wallet");
  });
});

describe("createRedeemRun when the wallet answers wallet_sendCalls with an error (L9)", () => {
  it.each([4200, 5700, 5710, 5740, 5750, 5760])(
    "asks again for a batch refused with %i, which creates no bundle, and it lands once",
    async (code) => {
      const world = newWorld();
      const { run, batch } = tab(world, { atomic: true, sendCallsRefuse: code });
      run.start();
      await settled(run);
      expect(progress(run).failure).toEqual({ reason: "wallet", retryable: true });

      run.retry();
      await reached(run, "complete");
      expect(batch.sendCalls).toHaveLength(2);
      expect(world.fake.broadcasts).toHaveLength(1);
    },
  );

  it.each([4001, 5000])("asks again for a batch declined with %i, which returned no bundle id", async (code) => {
    const world = newWorld();
    const { run, batch } = tab(world, { atomic: true, sendCallsRefuse: code });
    run.start();
    await settled(run);
    expect(progress(run).failure?.reason).toBe("rejected");
    expect(progress(run).holdsSend).toBeUndefined();

    run.retry();
    await reached(run, "complete");
    expect(batch.sendCalls).toHaveLength(2);
    expect(world.fake.broadcasts).toHaveLength(1);
  });

  it("keeps the batch id of a wallet_sendCalls declined in wording alone, which may follow a taken batch", async () => {
    const world = newWorld();
    let refused = false;
    const { run, requests } = tab(world, {
      atomic: true,
      answer: (method) =>
        method === "wallet_sendCalls" && !refused
          ? ((refused = true), Promise.reject(new Error("Sending failed: request rejected by the relay.")))
          : undefined,
    });
    run.start();
    await settled(run);

    expect(progress(run).holdsSend).toBe(true);
    if (progress(run).failure?.retryable) run.retry();
    await settled(run);
    expect(progress(run).stage).toBe("halted");
    expect(sendCallsOf(requests)).toHaveLength(1);
  });

  it("keeps the batch id of a wallet_sendCalls answered 5720, a duplicate id the wallet already holds", async () => {
    const world = newWorld();
    const { run, storage } = tab(world, { atomic: true, sendCallsRefuse: 5720 });
    run.start();
    await settled(run);

    expect(progress(run).stage).toBe("halted");
    expect(progress(run).failure?.reason).not.toBe("wallet");
    expect(progress(run).holdsSend).toBe(true);
    expect(stored(storage)?.callsId).toBeDefined();
  });

  it.each([-32601, 4200, 3, 4001])(
    "keeps a batch the wallet took when its status read is answered with %i, and never sends it again",
    async (code) => {
      const world = newWorld();
      const { run, batch } = tab(world, {
        atomic: true,
        answer: (method) => (method === "wallet_getCallsStatus" ? Promise.reject(coded(code)) : undefined),
      });
      run.start();
      await settled(run);
      expect(progress(run).stage).toBe("halted");
      expect(progress(run).failure?.reason).not.toBe("wallet");

      if (progress(run).failure?.retryable) run.retry();
      await settled(run);

      expect(batch.sendCalls).toHaveLength(1);
      expect(world.fake.broadcasts).toHaveLength(1);
    },
  );

  it("lets a completed batch run go, so the next run can start", async () => {
    const world = newWorld();
    const { run, storage } = tab(world, { atomic: true });
    run.start();
    await reached(run, "complete");
    expect(progress(run).holdsSend).toBeUndefined();

    run.reset();
    await vi.waitFor(() => expect(progress(run)).toEqual({ stage: "idle" }));

    expect(stored(storage)).toBeNull();
  });
});
