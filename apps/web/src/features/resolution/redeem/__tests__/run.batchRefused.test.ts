import { afterEach, describe, expect, it } from "vitest";

import {
  callOf,
  newWorld,
  PLANNED,
  progress,
  reached,
  recovered,
  refusingStorage,
  runs,
  settled,
  tab,
} from "./support/tabs";
import { timesBroadcast } from "./support/world";

afterEach(() => {
  for (const run of runs.splice(0)) run.dispose();
});

const REFUSALS = [5700, 5710, 5740, 5750, 5760];
const coded = (code: number) => Object.assign(new Error("The wallet refused the request."), { code });
const sendCallsOf = (requests: { method: string }[]) => requests.filter((each) => each.method === "wallet_sendCalls");
const storedSnapshot = (storage: { keys(): string[]; getItem(key: string): string | null }) =>
  (JSON.parse(storage.getItem(storage.keys()[0]!)!) as { snapshot: { atomic: boolean; callsId?: string } }).snapshot;

describe("createRedeemRun when the wallet refuses the atomic batch before taking it", () => {
  it.each(REFUSALS)("code %i: Try again signs the same calls one by one, each once", async (code) => {
    const world = newWorld();
    const { run, batch, sends, storage } = tab(world, { atomic: true, sendCallsRefuse: code });
    run.start();
    await settled(run);

    expect(progress(run).failure).toEqual({ reason: "batch-refused", retryable: true });
    expect(progress(run).holdsSend).toBeUndefined();
    expect(progress(run).atomic).toBeUndefined();
    expect(storedSnapshot(storage)).toMatchObject({ atomic: false });
    expect(storedSnapshot(storage).callsId).toBeUndefined();

    run.retry();
    await reached(run, "complete");

    expect(batch.sendCalls).toHaveLength(1);
    expect(sends.prompts.map(callOf)).toEqual(PLANNED.map(callOf));
    expect(timesBroadcast(world.fake, PLANNED)).toEqual(PLANNED.map(() => 1));
  });

  it("keeps the switch across a reload: the next tab carries on one by one and asks for no batch", async () => {
    const world = newWorld();
    const first = tab(world, { atomic: true, sendCallsRefuse: 5750 });
    first.run.start();
    await settled(first.run);
    expect(progress(first.run).failure?.reason).toBe("batch-refused");
    first.run.dispose();

    const next = await recovered(world, first.storage, { atomic: true });
    expect(progress(next.run).stage).toBe("review");
    next.run.resume();
    await reached(next.run, "complete");

    expect(sendCallsOf(next.requests)).toHaveLength(0);
    expect(next.sends.prompts.map(callOf)).toEqual(PLANNED.map(callOf));
    expect(timesBroadcast(world.fake, PLANNED)).toEqual(PLANNED.map(() => 1));
  });

  it("asks for no batch again after Start over, and the new run signs one by one", async () => {
    const world = newWorld();
    const { run, batch, sends, requests } = tab(world, { atomic: true, sendCallsRefuse: 5750 });
    run.start();
    await settled(run);
    expect(progress(run).failure?.reason).toBe("batch-refused");

    run.reset();
    await reached(run, "idle");
    run.start();
    await reached(run, "complete");

    expect(batch.sendCalls).toHaveLength(1);
    expect(sendCallsOf(requests)).toHaveLength(1);
    expect(sends.prompts.map(callOf)).toEqual(PLANNED.map(callOf));
    expect(timesBroadcast(world.fake, PLANNED)).toEqual(PLANNED.map(() => 1));
  });

  it("stays on the batch it stored when the switch cannot be saved, and switches on Try again once it can", async () => {
    const world = newWorld();
    const { storage, refusing } = refusingStorage('"batchRefused":true');
    const { run, batch, sends } = tab(world, { atomic: true, sendCallsRefuse: 5750, storage });
    run.start();
    await settled(run);

    expect(progress(run).failure).toEqual({ reason: "storage", retryable: true });
    expect(refusing.refused).toBeGreaterThan(0);
    expect(storedSnapshot(storage)).toMatchObject({ atomic: true });
    const reloaded = await recovered(world, storage, { atomic: true });
    expect(progress(reloaded.run).stage).toBe("review");
    reloaded.run.dispose();

    refusing.on = false;
    run.retry();
    await settled(run);
    expect(progress(run).failure?.reason).toBe("batch-refused");
    run.retry();
    await reached(run, "complete");

    expect(batch.sendCalls).toHaveLength(1);
    expect(sends.prompts.map(callOf)).toEqual(PLANNED.map(callOf));
  });

  it("keeps the atomic run when the code answers the status read of a batch the wallet took", async () => {
    const world = newWorld();
    const { run, batch, sends } = tab(world, {
      atomic: true,
      answer: (method) => (method === "wallet_getCallsStatus" ? Promise.reject(coded(5750)) : undefined),
    });
    run.start();
    await settled(run);

    expect(progress(run).stage).toBe("halted");
    expect(progress(run).failure?.reason).not.toBe("batch-refused");
    expect(progress(run).atomic).toBe(true);
    expect(progress(run).holdsSend).toBe(true);
    expect(batch.sendCalls).toHaveLength(1);
    expect(sends.prompts).toHaveLength(0);
  });

  it("asks for the batch again after a decline (4001), which is not a refusal of the batch", async () => {
    const world = newWorld();
    const { run, batch, sends } = tab(world, { atomic: true, sendCallsRefuse: 4001 });
    run.start();
    await settled(run);
    expect(progress(run).failure?.reason).toBe("rejected");
    expect(progress(run).atomic).toBe(true);

    run.retry();
    await reached(run, "complete");

    expect(batch.sendCalls).toHaveLength(2);
    expect(sends.prompts).toHaveLength(0);
  });
});
