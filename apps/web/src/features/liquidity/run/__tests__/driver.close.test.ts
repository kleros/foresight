import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TOKEN_ID, TOKENS, live, mergeRequest, removeRequest, seedRequest } from "./support/requests";
import {
  CLOSES_AT,
  chain,
  disposeDrivers,
  driverOn,
  gateway,
  progressOf,
  wallet,
  type LiquidityRequestLike,
} from "./support/world";
import { decode, owner } from "../../flow/__tests__/support/session";

afterEach(disposeDrivers);

const MS = 1_000n;
/** A browser clock a day either side of the close, to show the chain's clock decides. */
const browserBefore = () => Number((CLOSES_AT - 86_400n) * MS);
const browserAfter = () => Number((CLOSES_AT + 86_400n) * MS);

/** A chain at `chainTime`; with `livePool`, the UP pool is live and holds the position `removeRequest` withdraws. */
function chainAt(chainTime: bigint, livePool: boolean) {
  const world = chain({ chainTime });
  if (!livePool) return world;
  world.setPool(TOKENS.upToken, TOKENS.outcome, live(5_000n, true));
  world.state.owners.set(TOKEN_ID, owner);
  return world;
}

/** Starts `request` on a chain whose pools are the ones it reviewed. */
function runAt(chainTime: bigint, request: LiquidityRequestLike, now: () => number) {
  const livePool =
    request.kind === "remove" || (request.kind === "seed" && request.input.branches[0]!.pools.up.status === "live");
  const fake = chainAt(chainTime, livePool);
  const sends = gateway(fake, owner);
  const { driver } = driverOn({ world: fake, gateway: sends, wallet: wallet(fake, owner), request, now });
  driver.start();
  return { fake, sends, driver };
}

const finished = (driver: Parameters<typeof progressOf>[0]) =>
  vi.waitFor(() => expect(["complete", "halted"]).toContain(progressOf(driver).stage), { timeout: 3_000 });

describe("createLiquidityRun at the session's close by chain time (L7)", () => {
  it.each([
    ["at the close", CLOSES_AT],
    ["a second after the close", CLOSES_AT + 1n],
    ["a day after the close", CLOSES_AT + 86_400n],
  ])("refuses a seed %s, with nothing prompted", async (_, chainTime) => {
    const { sends, driver } = runAt(chainTime, seedRequest(), browserBefore);

    await finished(driver);

    expect(progressOf(driver)).toMatchObject({ stage: "halted", failure: { reason: "closed" } });
    expect(sends.prompts).toEqual([]);
  });

  it("refuses an add to a live pool at the close", async () => {
    const pools = { up: live(5_000n, true), down: { status: "missing" as const } };
    const { sends, driver } = runAt(CLOSES_AT, seedRequest({ pools }), browserBefore);

    await finished(driver);

    expect(progressOf(driver).failure?.reason).toBe("closed");
    expect(sends.prompts).toEqual([]);
  });

  it("signs a seed a second before the close even when the browser's clock is past it", async () => {
    const { driver } = runAt(CLOSES_AT - 1n, seedRequest(), browserAfter);

    await finished(driver);

    expect(progressOf(driver).stage).toBe("complete");
  });

  it("stops a seed before its mint once the chain's clock passes the close mid-run", async () => {
    const fake = chainAt(CLOSES_AT - 30n, false);
    const sends = gateway(fake, owner, {
      // the parent split lands as the session closes
      onBroadcast: (tx) => {
        if (decode(tx).kind === "split") fake.state.chainTime = CLOSES_AT + 5n;
      },
    });
    const { driver } = driverOn({ world: fake, gateway: sends, wallet: wallet(fake, owner), request: seedRequest() });

    driver.start();
    await finished(driver);

    expect(progressOf(driver).failure?.reason).toBe("closed");
    const minted = sends.prompts.filter((tx) => {
      const decoded = decode(tx);
      return decoded.kind === "multicall" && decoded.inner.some((call) => call.name === "mint");
    });
    expect(minted).toEqual([]);
  });

  it.each([
    ["a remove", removeRequest(), CLOSES_AT],
    ["a remove", removeRequest(), CLOSES_AT + 86_400n],
    ["a merge", mergeRequest(), CLOSES_AT],
    ["a merge", mergeRequest(), CLOSES_AT + 86_400n],
  ])("signs %s with the chain's clock at %s, at or after the close", async (_, request, chainTime) => {
    const { sends, driver } = runAt(chainTime, request, browserAfter);

    await finished(driver);

    expect(progressOf(driver).stage).toBe("complete");
    expect(sends.prompts.length).toBeGreaterThan(0);
  });

  it("refuses a seed exactly when the chain's clock is at or past the close, and never a remove", async () => {
    await fc.assert(
      fc.asyncProperty(fc.bigInt({ min: -3_600n, max: 3_600n }), async (offset) => {
        const seed = runAt(CLOSES_AT + offset, seedRequest(), browserBefore);
        const remove = runAt(CLOSES_AT + offset, removeRequest(), browserBefore);

        await finished(seed.driver);
        await finished(remove.driver);

        expect(progressOf(seed.driver).stage === "complete").toBe(offset < 0n);
        expect(progressOf(remove.driver).stage).toBe("complete");
        seed.driver.dispose();
        remove.driver.dispose();
      }),
      { numRuns: 25, examples: [[0n], [-1n], [1n]] },
    );
  });
});
