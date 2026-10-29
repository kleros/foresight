import { createMemoryStorage, type FlowRunStorage } from "@foresight/tx-orchestrator";
import { afterEach, describe, expect, it, vi } from "vitest";

import { seedRequest } from "./support/requests";
import { chain, disposeDrivers, driverOn, gateway, progressOf, wallet } from "./support/world";
import { owner } from "../../flow/__tests__/support/session";

afterEach(disposeDrivers);

interface Written {
  snapshot?: { sends?: Record<string, unknown>; callsId?: string };
}

/** Storage that is full for any write `refuses`; every other write lands. */
function fullFor(refuses: (run: Written) => boolean): FlowRunStorage {
  const storage = createMemoryStorage();
  return {
    ...storage,
    setItem(key, value) {
      if (refuses(JSON.parse(value) as Written))
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      storage.setItem(key, value);
    },
  };
}

describe("createLiquidityRun, when the stored send cannot be written (L8)", () => {
  it("stops a sequential run as storage before the wallet is asked", async () => {
    const fake = chain();
    const sends = gateway(fake, owner);
    const { driver } = driverOn({
      world: fake,
      gateway: sends,
      wallet: wallet(fake, owner),
      request: seedRequest(),
      storage: fullFor((run) => Object.keys(run.snapshot?.sends ?? {}).length > 0),
    });

    driver.start();

    await vi.waitFor(() =>
      expect(progressOf(driver)).toEqual({ stage: "halted", failure: { reason: "storage", retryable: true } }),
    );
    expect(sends.prompts).toEqual([]);
  });

  it("stops an atomic run as storage before the batch is sent", async () => {
    const fake = chain();
    const batch = wallet(fake, owner, { atomic: "supported" });
    const { driver } = driverOn({
      world: fake,
      gateway: gateway(fake, owner),
      wallet: batch,
      request: seedRequest(),
      storage: fullFor((run) => run.snapshot?.callsId !== undefined),
    });

    driver.start();

    await vi.waitFor(() =>
      expect(progressOf(driver)).toEqual({ stage: "halted", failure: { reason: "storage", retryable: true } }),
    );
    expect(batch.sendCalls).toEqual([]);
  });
});
