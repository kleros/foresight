import { afterEach, describe, expect, it, vi } from "vitest";

import { seedRequest } from "./support/requests";
import { chain, disposeDrivers, driverOn, gateway, progressOf, storedRun, wallet } from "./support/world";
import { owner } from "../../flow/__tests__/support/session";

afterEach(disposeDrivers);

describe("createLiquidityRun reset", () => {
  it("forgets a halted run with no send that may still land", async () => {
    const fake = chain();
    const sends = gateway(fake, owner, { script: (index) => (index === 0 ? "reject" : "sign") });
    const { driver, store, flowId } = driverOn({
      world: fake,
      gateway: sends,
      wallet: wallet(fake, owner),
      request: seedRequest(),
    });
    driver.start();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("halted"));

    driver.reset();

    expect(progressOf(driver)).toEqual({ stage: "idle" });
    expect(storedRun(store, flowId)).toBeNull();
  });

  it("keeps a recovered run whose stored send may still land", async () => {
    const fake = chain();
    const first = gateway(fake, owner, { script: (index) => (index === 1 ? "hang" : "sign") });
    const tab = driverOn({ world: fake, gateway: first, wallet: wallet(fake, owner), request: seedRequest() });
    tab.driver.start();
    await first.held();
    tab.driver.dispose();
    const { driver, store, flowId } = driverOn({
      world: fake,
      gateway: gateway(fake, owner),
      wallet: wallet(fake, owner),
      request: seedRequest(),
      storage: tab.storage,
    });
    driver.recover();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("review"));

    driver.reset();

    expect(storedRun(store, flowId)).not.toBeNull();
  });
});
