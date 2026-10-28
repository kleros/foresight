import { afterEach, describe, expect, it, vi } from "vitest";

import { seedInput, seedRequest, seedTxs } from "./support/requests";
import {
  chain,
  copyStorage,
  disposeDrivers,
  driverOn,
  gateway,
  progressOf,
  timesBroadcast,
  wallet,
} from "./support/world";
import { owner } from "../../flow/__tests__/support/session";
import { SEND_HOLD_MS } from "../driver";

afterEach(disposeDrivers);

const T0 = 1_700_000_000_000;

/** A seed whose third prompt was open, and never answered, when its tab closed. */
async function leftOpen() {
  const fake = chain();
  const first = gateway(fake, owner, { script: (index) => (index === 2 ? "hang" : "sign") });
  const tab = driverOn({
    world: fake,
    gateway: first,
    wallet: wallet(fake, owner),
    request: seedRequest(),
    now: () => T0,
  });
  tab.driver.start();
  await first.held();
  const left = copyStorage(tab.storage);
  tab.driver.dispose();
  return { fake, left };
}

describe("createLiquidityRun recovering a prompt nobody answered (L8)", () => {
  it("signs nothing for it while the prompt may still be answered", async () => {
    const { fake, left } = await leftOpen();
    const second = gateway(fake, owner);
    const { driver } = driverOn({
      world: fake,
      gateway: second,
      wallet: wallet(fake, owner),
      request: seedRequest(),
      storage: left,
      now: () => T0 + SEND_HOLD_MS - 1,
    });

    driver.recover();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("review"));
    driver.resume();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("halted"));

    expect(progressOf(driver).failure).toEqual({ reason: "held", retryable: true });
    expect(second.prompts).toEqual([]);
  });

  it("signs it again once the hold has passed with its nonce unused", async () => {
    const { fake, left } = await leftOpen();
    const planned = seedTxs(seedInput());
    const { driver } = driverOn({
      world: fake,
      gateway: gateway(fake, owner),
      wallet: wallet(fake, owner),
      request: seedRequest(),
      storage: left,
      now: () => T0 + SEND_HOLD_MS,
    });

    driver.recover();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("review"));
    driver.resume();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("complete"));

    expect(timesBroadcast(fake, planned)).toEqual(planned.map(() => 1));
  });

  it("finishes without signing it again once the prompt was approved after the tab closed", async () => {
    const { fake, left } = await leftOpen();
    const planned = seedTxs(seedInput());
    const second = gateway(fake, owner);
    const { driver } = driverOn({
      world: fake,
      gateway: second,
      wallet: wallet(fake, owner),
      request: seedRequest(),
      storage: left,
      now: () => T0 + 1,
    });
    fake.approveLater(planned[2]!, owner);

    driver.recover();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("review"));
    driver.resume();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("complete"));

    expect(second.prompts).toEqual(planned.slice(3));
    expect(timesBroadcast(fake, planned)).toEqual(planned.map(() => 1));
  });
});
