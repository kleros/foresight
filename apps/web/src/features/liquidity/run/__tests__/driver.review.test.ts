import type { FlowTx } from "@foresight/tx-orchestrator";
import { afterEach, describe, expect, it, vi } from "vitest";

import { decode, owner } from "../../flow/__tests__/support/session";
import type { PoolState } from "../../types";
import {
  REMOVE_PRICE,
  TOKEN_ID,
  TOKENS,
  empty,
  live,
  removeRequest,
  seedInput,
  seedRequest,
  seedTxs,
} from "./support/requests";
import { chain, disposeDrivers, driverOn, gateway, progressOf, timesBroadcast, wallet } from "./support/world";

afterEach(disposeDrivers);

const MISSING: PoolState = { status: "missing" };

const mints = (txs: readonly FlowTx[]) =>
  txs.filter((tx) => {
    const decoded = decode(tx);
    return decoded.kind === "multicall" && decoded.inner.some((call) => call.name === "mint");
  });

const moved = (driver: Parameters<typeof progressOf>[0]) =>
  vi.waitFor(() => expect(progressOf(driver).stage).toBe("moved"), { timeout: 3_000 });

/** The UP pool as reviewed, and as the chain holds it when the run is built. */
const changes: Array<[string, PoolState, PoolState]> = [
  ["a missing pool someone created and seeded", MISSING, live(4_000n, true)],
  ["a live pool whose price moved", live(5_000n, true), live(4_000n, true)],
  ["an empty pool that gained liquidity", empty(3_000n, true), live(3_000n, true)],
  ["a live pool someone emptied", live(5_000n, true), empty(5_000n, true)],
];

describe("createLiquidityRun re-reading the pools at build (L10)", () => {
  it.each(changes)("stops for a new review, signing no mint, on %s", async (_, reviewed, now) => {
    const fake = chain();
    fake.setPool(TOKENS.upToken, TOKENS.outcome, now);
    const sends = gateway(fake, owner);
    const request = seedRequest({ pools: { up: reviewed, down: MISSING } });
    const { driver } = driverOn({ world: fake, gateway: sends, wallet: wallet(fake, owner), request });

    driver.start();
    await moved(driver);

    expect(mints(sends.prompts)).toEqual([]);
  });

  it("stops before the mint when a pool changes after the run's first transactions landed", async () => {
    const fake = chain();
    const planned = seedTxs(seedInput());
    const sends = gateway(fake, owner, {
      // the parent split lands as someone seeds the UP pool
      onBroadcast: (tx) => {
        if (decode(tx).kind === "split") fake.setPool(TOKENS.upToken, TOKENS.outcome, live(4_000n, true));
      },
    });
    const { driver } = driverOn({ world: fake, gateway: sends, wallet: wallet(fake, owner), request: seedRequest() });

    driver.start();
    await moved(driver);

    expect(sends.prompts.length).toBeGreaterThan(0);
    expect(mints(sends.prompts)).toEqual([]);
    expect(timesBroadcast(fake, sends.prompts).every((times) => times === 1)).toBe(true);
    expect(planned.length).toBeGreaterThan(sends.prompts.length);
  });

  it("signs the whole seed when the pools read at build are the ones reviewed", async () => {
    const fake = chain();
    fake.setPool(TOKENS.upToken, TOKENS.outcome, live(5_000n, true));
    const sends = gateway(fake, owner);
    const pools = { up: live(5_000n, true), down: MISSING };
    const { driver } = driverOn({
      world: fake,
      gateway: sends,
      wallet: wallet(fake, owner),
      request: seedRequest({ pools }),
    });

    driver.start();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("complete"), { timeout: 3_000 });

    expect(sends.prompts).toEqual(seedTxs(seedInput({ pools })));
  });

  it("sends no atomic batch when a pool changed since review", async () => {
    const fake = chain();
    fake.setPool(TOKENS.upToken, TOKENS.outcome, live(4_000n, true));
    const sends = gateway(fake, owner);
    const batch = wallet(fake, owner, { atomic: "supported" });
    const { driver } = driverOn({ world: fake, gateway: sends, wallet: batch, request: seedRequest() });

    driver.start();
    await moved(driver);

    expect(batch.sendCalls).toEqual([]);
    expect(mints(sends.prompts)).toEqual([]);
  });

  it("stops a remove for a new review when its pool's price moved", async () => {
    const fake = chain();
    fake.setPool(TOKENS.upToken, TOKENS.outcome, live(4_000n, true));
    fake.state.owners.set(TOKEN_ID, owner);
    const sends = gateway(fake, owner);
    const { driver } = driverOn({
      world: fake,
      gateway: sends,
      wallet: wallet(fake, owner),
      request: removeRequest({ sqrtPriceX96: REMOVE_PRICE }),
    });

    driver.start();
    await moved(driver);

    expect(sends.prompts).toEqual([]);
  });
});
