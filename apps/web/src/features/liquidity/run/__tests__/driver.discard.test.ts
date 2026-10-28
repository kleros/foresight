import { afterEach, describe, expect, it, vi } from "vitest";

import { seedInput, seedRequest, seedTxs } from "./support/requests";
import {
  chain,
  copyStorage,
  disposeDrivers,
  driverOn,
  gateway,
  movesMoney,
  progressOf,
  settled,
  storedRun,
  timesBroadcast,
  wallet,
  type Chain,
} from "./support/world";
import { owner, stranger } from "../../flow/__tests__/support/session";

afterEach(disposeDrivers);

const PLANNED = seedTxs(seedInput());
const SPLIT_AT = PLANNED.findIndex(movesMoney);
const tick = () => new Promise((resolve) => setTimeout(resolve, 30));

/** A seed whose parent split prompt was open when its tab closed, on a copy of that tab's storage. */
async function leftOpen() {
  const fake = chain();
  const first = gateway(fake, owner, { script: (index) => (index === SPLIT_AT ? "hang" : "sign") });
  const tab = driverOn({ world: fake, gateway: first, wallet: wallet(fake, owner), request: seedRequest() });
  tab.driver.start();
  await first.held();
  const left = copyStorage(tab.storage);
  tab.driver.dispose();
  return { fake, left, hung: first.hung[0]! };
}

/** A second tab on `left` for `account`, recovered, resumed where it reaches review, and left where it rests. */
async function reopened(fake: Chain, left: ReturnType<typeof copyStorage>, account = owner) {
  const sends = gateway(fake, owner);
  const batch = wallet(fake, owner, { atomic: "supported", status: "unknown" });
  const tab = driverOn({
    world: fake,
    gateway: sends,
    wallet: batch,
    request: seedRequest(),
    storage: left,
    account: () => account,
  });
  tab.driver.recover();
  await settled(tab.driver);
  if (progressOf(tab.driver).stage === "review") tab.driver.resume();
  await settled(tab.driver);
  return { ...tab, sends, batch };
}

describe("createLiquidityRun discard", () => {
  it("forgets a run halted as batch-unknown, which reset keeps, and sends nothing (L9)", async () => {
    const fake = chain();
    const firstWallet = wallet(fake, owner, { atomic: "supported", sendCalls: "hang" });
    const first = driverOn({ world: fake, gateway: gateway(fake, owner), wallet: firstWallet, request: seedRequest() });
    first.driver.start();
    await firstWallet.sent();
    const left = copyStorage(first.storage);
    first.driver.dispose();
    const { driver, store, flowId, sends, batch } = await reopened(fake, left);
    expect(progressOf(driver)).toEqual({ stage: "halted", failure: { reason: "batch-unknown", retryable: false } });

    driver.reset();
    expect(storedRun(store, flowId)).not.toBeNull();
    driver.discard();
    await tick();

    expect(progressOf(driver)).toEqual({ stage: "idle" });
    expect(storedRun(store, flowId)).toBeNull();
    expect(batch.sendCalls).toEqual([]);
    expect(sends.prompts).toEqual([]);
  });

  it("forgets a run halted as reverted, which reset keeps, and sends nothing", async () => {
    const fake = chain();
    const sends = gateway(fake, owner, { script: (index) => (index === SPLIT_AT ? "revert" : "sign") });
    const { driver, store, flowId } = driverOn({
      world: fake,
      gateway: sends,
      wallet: wallet(fake, owner),
      request: seedRequest(),
    });
    driver.start();
    await vi.waitFor(() => expect(progressOf(driver).failure?.reason).toBe("reverted"));
    const before = sends.prompts.length;

    driver.reset();
    expect(storedRun(store, flowId)).not.toBeNull();
    driver.discard();
    await tick();

    expect(progressOf(driver)).toEqual({ stage: "idle" });
    expect(storedRun(store, flowId)).toBeNull();
    expect(sends.prompts).toHaveLength(before);
  });

  it("forgets a run held on a prompt the chain shows no send of, and signs nothing", async () => {
    const { fake, left } = await leftOpen();
    const { driver, store, flowId, sends } = await reopened(fake, left);
    expect(progressOf(driver).failure?.reason).toBe("held");

    driver.discard();
    await tick();

    expect(progressOf(driver)).toEqual({ stage: "idle" });
    expect(storedRun(store, flowId)).toBeNull();
    expect(sends.prompts).toEqual([]);
  });

  it("keeps a run whose send is broadcast and not yet mined", async () => {
    const { fake, left, hung } = await leftOpen();
    fake.broadcast(hung, owner, false);
    const { driver, store, flowId } = await reopened(fake, left);
    expect(progressOf(driver).failure?.reason).toBe("pending");

    driver.discard();
    await tick();

    expect(storedRun(store, flowId)).not.toBeNull();
    expect(progressOf(driver).failure?.reason).toBe("pending");
  });

  it("keeps another account's run", async () => {
    const { fake, left } = await leftOpen();
    const { driver, store, flowId } = await reopened(fake, left, stranger);
    expect(progressOf(driver).failure?.reason).toBe("wrong-wallet");

    driver.discard();
    await tick();

    expect(storedRun(store, flowId)).not.toBeNull();
  });

  it("keeps a run whose send was broadcast before its receipt wait failed, and that send lands once", async () => {
    const fake = chain();
    const sends = gateway(fake, owner, { script: (index) => (index === SPLIT_AT ? "unmined" : "sign") });
    const wait = sends.port.waitForReceipt;
    let failed = false;
    sends.port.waitForReceipt = (args) => {
      if (failed) return wait(args);
      failed = true;
      return Promise.reject(new Error("boom"));
    };
    const { driver, store, flowId } = driverOn({
      world: fake,
      gateway: sends,
      wallet: wallet(fake, owner),
      request: seedRequest(),
    });
    driver.start();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("halted"));

    await driver.discard();

    expect(storedRun(store, flowId)).not.toBeNull();
    expect(progressOf(driver)).toEqual({ stage: "halted", failure: { reason: "pending", retryable: true } });
    fake.land();
    driver.retry();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("complete"));
    expect(timesBroadcast(fake, PLANNED)).toEqual(PLANNED.map(() => 1));
  });

  it("keeps a run held on a prompt that was approved, broadcast and not yet mined since it halted", async () => {
    const { fake, left, hung } = await leftOpen();
    const { driver, store, flowId } = await reopened(fake, left);
    expect(progressOf(driver).failure?.reason).toBe("held");
    fake.broadcast(hung, owner, false);

    await driver.discard();

    expect(storedRun(store, flowId)).not.toBeNull();
    expect(progressOf(driver)).toEqual({ stage: "halted", failure: { reason: "pending", retryable: true } });
    fake.land();
    driver.retry();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("complete"));
    expect(timesBroadcast(fake, PLANNED)).toEqual(PLANNED.map(() => 1));
  });

  it("keeps a run that has not halted", async () => {
    const { fake, left } = await leftOpen();
    const sends = gateway(fake, owner);
    const { driver, store, flowId } = driverOn({
      world: fake,
      gateway: sends,
      wallet: wallet(fake, owner),
      request: seedRequest(),
      storage: left,
    });
    driver.recover();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("review"));

    await driver.discard();

    expect(storedRun(store, flowId)).not.toBeNull();
    expect(progressOf(driver)).toEqual({ stage: "review" });
  });
});
