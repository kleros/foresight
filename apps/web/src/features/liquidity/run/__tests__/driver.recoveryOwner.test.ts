import { createFlowRunStore } from "@foresight/tx-orchestrator";
import type { Address } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import { seedInput, seedRequest, seedTxs } from "./support/requests";
import {
  chain,
  copyStorage,
  disposeDrivers,
  driverOn,
  gateway,
  progressOf,
  storedRun,
  timesBroadcast,
  wallet,
  type Chain,
} from "./support/world";
import { owner, stranger } from "../../flow/__tests__/support/session";

afterEach(disposeDrivers);

const OTHER: Address = "0x00000000000000000000000000000000000000c3";

/** A seed the owner started and refused at its third prompt, left in storage as a closed tab leaves it. */
async function ownersPausedRun(fake: Chain) {
  const sends = gateway(fake, owner, { script: (index) => (index === 2 ? "reject" : "sign") });
  const tab = driverOn({ world: fake, gateway: sends, wallet: wallet(fake, owner), request: seedRequest() });
  tab.driver.start();
  await vi.waitFor(() => expect(progressOf(tab.driver).stage).toBe("halted"), { timeout: 3_000 });
  const left = copyStorage(tab.storage);
  tab.driver.dispose();
  return left;
}

const others: Array<[string, () => Address | undefined]> = [
  ["another account", () => stranger],
  ["a third account", () => OTHER],
  ["no account", () => undefined],
];

describe("createLiquidityRun recovering a run the owner left (L4)", () => {
  it.each(others)("prompts for nothing while %s is connected", async (_, account) => {
    const fake = chain();
    const left = await ownersPausedRun(fake);
    const sends = gateway(fake, stranger);
    const batch = wallet(fake, stranger, { atomic: "supported" });
    const { driver } = driverOn({
      world: fake,
      gateway: sends,
      wallet: batch,
      request: seedRequest(),
      storage: left,
      account,
    });

    driver.recover();
    await vi.waitFor(() => expect(["halted", "review"]).toContain(progressOf(driver).stage), { timeout: 3_000 });
    driver.resume();
    driver.retry();
    driver.start();
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(sends.prompts).toEqual([]);
    expect(batch.sendCalls).toEqual([]);
  });

  it.each(others)("halts as the wrong wallet while %s is connected", async (_, account) => {
    const fake = chain();
    const left = await ownersPausedRun(fake);
    const { driver } = driverOn({
      world: fake,
      gateway: gateway(fake, stranger),
      wallet: wallet(fake, stranger),
      request: seedRequest(),
      storage: left,
      account,
    });

    driver.recover();
    driver.resume();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("halted"), { timeout: 3_000 });

    expect(progressOf(driver).failure?.reason).toBe("wrong-wallet");
  });

  it.each(others)("keeps the owner's run while %s is connected", async (_, account) => {
    const fake = chain();
    const left = await ownersPausedRun(fake);
    const before = storedRun(createFlowRunStore({ storage: copyStorage(left) }), "liquidity-session-1");
    const { driver, store, flowId } = driverOn({
      world: fake,
      gateway: gateway(fake, stranger),
      wallet: wallet(fake, stranger),
      request: seedRequest(),
      storage: left,
      account,
    });

    driver.recover();
    driver.resume();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("halted"), { timeout: 3_000 });

    expect(storedRun(store, flowId)?.steps).toEqual(before?.steps);
  });

  it.each([
    ["as it was", () => owner],
    ["in another letter case", () => owner.toUpperCase().replace("0X", "0x") as Address],
  ])("finishes the owner's run, sending nothing twice, once the owner reconnects %s", async (_, account) => {
    const fake = chain();
    const left = await ownersPausedRun(fake);
    const planned = seedTxs(seedInput());
    const { driver } = driverOn({
      world: fake,
      gateway: gateway(fake, owner),
      wallet: wallet(fake, owner),
      request: seedRequest(),
      storage: left,
      account,
    });

    driver.recover();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("review"), { timeout: 3_000 });
    driver.resume();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("complete"), { timeout: 3_000 });

    expect(timesBroadcast(fake, planned)).toEqual(planned.map(() => 1));
  });
});
