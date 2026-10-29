import { afterEach, describe, expect, it, vi } from "vitest";

import { seedInput, seedRequest, seedTxs } from "./support/requests";
import {
  chain,
  disposeDrivers,
  driverOn,
  gateway,
  movesMoney,
  progressOf,
  storedRun,
  timesBroadcast,
  wallet,
} from "./support/world";
import { owner } from "../../flow/__tests__/support/session";

afterEach(disposeDrivers);

const PLANNED = seedTxs(seedInput());
const SPLIT_AT = PLANNED.findIndex(movesMoney);

/** A seed whose parent split prompt is answered with `code` once, every other prompt signed. */
function refusedOnce(code: number) {
  const fake = chain();
  let refused = false;
  const sends = gateway(fake, owner, {
    script: (index) => (index === SPLIT_AT && !refused ? ((refused = true), { refuse: code }) : "sign"),
  });
  const tab = driverOn({ world: fake, gateway: sends, wallet: wallet(fake, owner), request: seedRequest() });
  return { fake, sends, ...tab };
}

describe("createLiquidityRun when the wallet answers a prompt with an error", () => {
  it.each([4100, 4200, 4900, 4901, -32601, -32602, 3])(
    "lets go of a send answered with %i, which opens no prompt, so Try again asks again, each step once",
    async (code) => {
      const { fake, sends, driver, store, flowId } = refusedOnce(code);
      driver.start();
      await vi.waitFor(() => expect(progressOf(driver).failure).toEqual({ reason: "wallet", retryable: true }));

      expect(driver.getProgress().holdsSend).toBeUndefined();
      const stored = storedRun(store, flowId)!;
      expect(Object.keys((stored.snapshot as { sends: object }).sends)).toHaveLength(SPLIT_AT);

      driver.retry();
      await vi.waitFor(() => expect(progressOf(driver).stage).toBe("complete"));
      expect(sends.prompts).toHaveLength(PLANNED.length + 1);
      expect(timesBroadcast(fake, PLANNED)).toEqual(PLANNED.map(() => 1));
    },
  );

  it("keeps a send answered with -32603, which a wallet also gives after a broadcast, and asks for nothing again", async () => {
    const { sends, driver } = refusedOnce(-32603);
    driver.start();
    await vi.waitFor(() => expect(progressOf(driver).failure?.retryable).toBe(true));
    expect(driver.getProgress().holdsSend).toBe(true);
    const asked = sends.prompts.length;

    driver.retry();
    await vi.waitFor(() => expect(progressOf(driver).failure?.reason).toBe("held"));

    expect(sends.prompts).toHaveLength(asked);
  });

  it("reads a code-3 revert from the chain while building as no wallet answer", async () => {
    const fake = chain();
    const sends = gateway(fake, owner);
    const { driver } = driverOn({ world: fake, gateway: sends, wallet: wallet(fake, owner), request: seedRequest() });
    const read = fake.reader.chainTime;
    let calls = 0;
    fake.reader.chainTime = () => {
      calls += 1;
      if (calls === 3) {
        return Promise.reject(
          new Error("read failed", { cause: Object.assign(new Error("execution reverted"), { code: 3 }) }),
        );
      }
      return read();
    };

    driver.start();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("halted"));

    expect(progressOf(driver).failure?.reason).not.toBe("wallet");
  });
});
