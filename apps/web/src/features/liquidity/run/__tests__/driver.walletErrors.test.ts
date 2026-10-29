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
  it.each([4100, 4200, -32601, -32602, 3])(
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

  it.each([-32603, 4900, 4901])(
    "keeps a send answered with %i, which may follow a signature, and asks for nothing again",
    async (code) => {
      const { sends, driver } = refusedOnce(code);
      driver.start();
      await vi.waitFor(() => expect(progressOf(driver).stage).toBe("halted"));
      expect(driver.getProgress().holdsSend).toBe(true);
      const asked = sends.prompts.length;

      if (progressOf(driver).failure?.retryable) {
        driver.retry();
        await vi.waitFor(() => expect(progressOf(driver).failure?.reason).toBe("held"));
      }

      expect(progressOf(driver).failure?.reason).not.toBe("wallet");
      expect(sends.prompts).toHaveLength(asked);
    },
  );

  it("asks again for a batch whose wallet_sendCalls was answered with 4200, and it lands once (L9)", async () => {
    const fake = chain();
    const batch = wallet(fake, owner, { atomic: "supported", sendCallsRefuse: 4200 });
    const { driver } = driverOn({ world: fake, gateway: gateway(fake, owner), wallet: batch, request: seedRequest() });
    driver.start();
    await vi.waitFor(() => expect(progressOf(driver).failure).toEqual({ reason: "wallet", retryable: true }));

    driver.retry();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("complete"));

    expect(batch.sendCalls).toHaveLength(2);
    expect(fake.broadcasts).toHaveLength(1);
  });

  it.each([-32601, 4200, 3, 4001])(
    "keeps a batch the wallet took when its status read is answered with %i, and never sends it again (L9)",
    async (code) => {
      const fake = chain();
      const batch = wallet(fake, owner, { atomic: "supported", statusRefuse: code });
      const { driver } = driverOn({
        world: fake,
        gateway: gateway(fake, owner),
        wallet: batch,
        request: seedRequest(),
      });
      driver.start();
      await vi.waitFor(() => expect(progressOf(driver).stage).toBe("halted"));
      expect(progressOf(driver).failure?.reason).not.toBe("wallet");

      if (progressOf(driver).failure?.retryable) driver.retry();
      await vi.waitFor(() => expect(["complete", "halted"]).toContain(progressOf(driver).stage));

      expect(batch.sendCalls).toHaveLength(1);
      expect(fake.broadcasts).toHaveLength(1);
    },
  );

  it("keeps a send whose wallet error only reads as a rejection, so a split that broadcast is not sent again (L8)", async () => {
    const fake = chain();
    let failed = false;
    const sends = gateway(fake, owner, {
      script: (index) =>
        index === SPLIT_AT && !failed
          ? ((failed = true), { message: "User rejected the request.", broadcast: true })
          : "sign",
    });
    const { driver } = driverOn({ world: fake, gateway: sends, wallet: wallet(fake, owner), request: seedRequest() });
    driver.start();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("halted"));
    expect(driver.getProgress().holdsSend).toBe(true);

    driver.retry();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("complete"));

    expect(timesBroadcast(fake, PLANNED)).toEqual(PLANNED.map(() => 1));
  });

  it.each([5700, 5710, 5740, 5750, 5760])(
    "asks again for a batch whose wallet_sendCalls was refused with %i, which creates no bundle (L9)",
    async (code) => {
      const fake = chain();
      const batch = wallet(fake, owner, { atomic: "supported", sendCallsRefuse: code });
      const { driver } = driverOn({
        world: fake,
        gateway: gateway(fake, owner),
        wallet: batch,
        request: seedRequest(),
      });
      driver.start();
      await vi.waitFor(() => expect(progressOf(driver).failure).toEqual({ reason: "wallet", retryable: true }));

      driver.retry();
      await vi.waitFor(() => expect(progressOf(driver).stage).toBe("complete"));
      expect(batch.sendCalls).toHaveLength(2);
      expect(fake.broadcasts).toHaveLength(1);
    },
  );

  it.each([
    ["4001", 4001],
    ["WalletConnect's 5000", { code: 5000, message: "User rejected." }],
  ] as const)(
    "asks again for a batch whose wallet_sendCalls was declined with %s, which returned no bundle id (L9)",
    async (_, refusal) => {
      const fake = chain();
      const batch = wallet(fake, owner, { atomic: "supported", sendCallsRefuse: refusal });
      const { driver } = driverOn({
        world: fake,
        gateway: gateway(fake, owner),
        wallet: batch,
        request: seedRequest(),
      });
      driver.start();
      await vi.waitFor(() => expect(progressOf(driver).failure?.reason).toBe("rejected"));
      expect(driver.getProgress().holdsSend).toBeUndefined();

      driver.retry();
      await vi.waitFor(() => expect(progressOf(driver).stage).toBe("complete"));
      expect(batch.sendCalls).toHaveLength(2);
      expect(fake.broadcasts).toHaveLength(1);
    },
  );

  it("keeps the batch id of a wallet_sendCalls declined in wording alone, which may follow a taken batch (L9)", async () => {
    const fake = chain();
    const batch = wallet(fake, owner, {
      atomic: "supported",
      sendCallsRefuse: { message: "Sending failed: request rejected by the relay." },
    });
    const { driver } = driverOn({ world: fake, gateway: gateway(fake, owner), wallet: batch, request: seedRequest() });
    driver.start();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("halted"));

    expect(driver.getProgress().holdsSend).toBe(true);
    if (progressOf(driver).failure?.retryable) driver.retry();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("halted"));
    expect(batch.sendCalls).toHaveLength(1);
  });

  it("keeps the batch id of a wallet_sendCalls answered 5720, a duplicate id the wallet already holds (L9)", async () => {
    const fake = chain();
    const batch = wallet(fake, owner, { atomic: "supported", sendCallsRefuse: 5720 });
    const { driver } = driverOn({ world: fake, gateway: gateway(fake, owner), wallet: batch, request: seedRequest() });
    driver.start();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("halted"));

    expect(progressOf(driver).failure?.reason).not.toBe("wallet");
    expect(driver.getProgress().holdsSend).toBe(true);
  });

  it("lets a completed batch run go, so the next run can start", async () => {
    const fake = chain();
    const batch = wallet(fake, owner, { atomic: "supported" });
    const { driver, store, flowId } = driverOn({
      world: fake,
      gateway: gateway(fake, owner),
      wallet: batch,
      request: seedRequest(),
    });
    driver.start();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("complete"));
    expect(driver.getProgress().holdsSend).toBeUndefined();

    driver.reset();

    expect(progressOf(driver)).toEqual({ stage: "idle" });
    expect(storedRun(store, flowId)).toBeNull();
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
