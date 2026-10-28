import { afterEach, describe, expect, it, vi } from "vitest";

import { TOKEN_ID, TOKENS, live, removeRequest, seedRequest } from "./support/requests";
import { chain, copyStorage, disposeDrivers, driverOn, gateway, progressOf, wallet } from "./support/world";
import { owner, stranger } from "../../flow/__tests__/support/session";

afterEach(disposeDrivers);

const halted = (driver: Parameters<typeof progressOf>[0]) =>
  vi.waitFor(() => expect(progressOf(driver).stage).toBe("halted"), { timeout: 3_000 });

describe("createLiquidityRun guards before a prompt", () => {
  it("prompts for nothing while the account has a send broadcast and not yet mined", async () => {
    const fake = chain();
    fake.broadcast({ to: owner, data: "0x" }, owner, false);
    const sends = gateway(fake, owner);
    const { driver } = driverOn({ world: fake, gateway: sends, wallet: wallet(fake, owner), request: seedRequest() });

    driver.start();
    await halted(driver);

    expect(progressOf(driver).failure).toEqual({ reason: "pending", retryable: true });
    expect(sends.prompts).toEqual([]);
  });

  it("withdraws no position the connected account does not hold (L4)", async () => {
    const fake = chain();
    fake.setPool(TOKENS.upToken, TOKENS.outcome, live(5_000n, true));
    fake.state.owners.set(TOKEN_ID, stranger);
    const sends = gateway(fake, owner);
    const { driver } = driverOn({ world: fake, gateway: sends, wallet: wallet(fake, owner), request: removeRequest() });

    driver.start();
    await halted(driver);

    expect(progressOf(driver).failure?.reason).toBe("unlisted");
    expect(sends.prompts).toEqual([]);
  });

  it("halts a reloaded batch the wallet reports as reverted, sending it again neither way", async () => {
    const fake = chain();
    const first = wallet(fake, owner, { atomic: "supported", sendCalls: "hang" });
    const tab = driverOn({ world: fake, gateway: gateway(fake, owner), wallet: first, request: seedRequest() });
    tab.driver.start();
    await first.sent();
    const left = copyStorage(tab.storage);
    tab.driver.dispose();

    const second = wallet(fake, owner, { atomic: "supported" });
    const reverted = {
      request: (call: { method: string; params?: unknown }) =>
        call.method === "wallet_getCallsStatus"
          ? Promise.resolve({ version: "2.0.0", id: (call.params as [string])[0], chainId: "0x64", status: 500 })
          : second.port.request(call),
    };
    const sends = gateway(fake, owner);
    const { driver } = driverOn({
      world: fake,
      gateway: sends,
      wallet: { ...second, port: reverted },
      request: seedRequest(),
      storage: left,
    });
    driver.recover();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("review"));
    driver.resume();
    await halted(driver);
    driver.retry();

    expect(progressOf(driver).failure).toEqual({ reason: "batch-failed", retryable: false });
    expect(second.sendCalls).toEqual([]);
    expect(sends.prompts).toEqual([]);
  });

  it("halts a reloaded batch the wallet cannot report as not retryable", async () => {
    const fake = chain();
    const first = wallet(fake, owner, { atomic: "supported", sendCalls: "hang" });
    const tab = driverOn({ world: fake, gateway: gateway(fake, owner), wallet: first, request: seedRequest() });
    tab.driver.start();
    await first.sent();
    const left = copyStorage(tab.storage);
    tab.driver.dispose();

    const second = wallet(fake, owner, { atomic: "supported", status: "unknown" });
    const { driver } = driverOn({
      world: fake,
      gateway: gateway(fake, owner),
      wallet: second,
      request: seedRequest(),
      storage: left,
    });
    driver.recover();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("review"));
    driver.resume();
    await halted(driver);

    expect(progressOf(driver).failure).toEqual({ reason: "batch-unknown", retryable: false });
  });
});
