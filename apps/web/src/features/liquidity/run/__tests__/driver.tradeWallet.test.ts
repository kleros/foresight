import { afterEach, describe, expect, it, vi } from "vitest";

import { executorAddress } from "@/lib/trade-executor/executor";

import { tradeExecutorFactoryAddress } from "@/config/contracts";

import { SESSION, TOKEN_ID, TOKENS, live, removeInput } from "./support/requests";
import { chain, disposeDrivers, driverOn, gateway, progressOf, wallet } from "./support/world";
import type { LiquidityRequestLike } from "./support/world";
import { owner } from "../../flow/__tests__/support/session";

afterEach(disposeDrivers);

const tradeWallet = executorAddress(tradeExecutorFactoryAddress(100)!, owner);

/** Withdraws position TOKEN_ID of the UP pool, at its 50% price, as a position the trade wallet holds. */
const request: LiquidityRequestLike = {
  kind: "remove",
  session: SESSION,
  input: { ...removeInput(), tradeWallet },
};

describe("createLiquidityRun withdrawing trade wallet positions", () => {
  it("sends the trade wallet's batch once and completes when the trade wallet holds the position", async () => {
    const fake = chain();
    fake.setPool(TOKENS.upToken, TOKENS.outcome, live(5_000n, true));
    fake.state.owners.set(TOKEN_ID, tradeWallet);
    const sends = gateway(fake, owner);
    const { driver } = driverOn({ world: fake, gateway: sends, wallet: wallet(fake, owner), request });

    driver.start();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("complete"), { timeout: 3_000 });

    expect(sends.prompts).toHaveLength(1);
    expect(sends.prompts[0]!.to).toBe(tradeWallet);
  });

  it("withdraws nothing when the connected account holds the position instead of its trade wallet (L4)", async () => {
    const fake = chain();
    fake.setPool(TOKENS.upToken, TOKENS.outcome, live(5_000n, true));
    fake.state.owners.set(TOKEN_ID, owner);
    const sends = gateway(fake, owner);
    const { driver } = driverOn({ world: fake, gateway: sends, wallet: wallet(fake, owner), request });

    driver.start();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("halted"), { timeout: 3_000 });

    expect(progressOf(driver).failure?.reason).toBe("unlisted");
    expect(sends.prompts).toEqual([]);
  });
});
