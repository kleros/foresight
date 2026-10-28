import type { Address } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SESSION, TOKEN_ID, TOKENS, live, removeRequest, seedRequest } from "./support/requests";
import {
  chain,
  disposeDrivers,
  driverOn,
  gateway,
  progressOf,
  storedSends,
  wallet,
  type Chain,
  type LiquidityRequestLike,
} from "./support/world";
import { owner, stranger } from "../../flow/__tests__/support/session";
import { departures } from "../../flow/allowed";

afterEach(disposeDrivers);

function removeChain(): Chain {
  const world = chain();
  world.setPool(TOKENS.upToken, TOKENS.outcome, live(5_000n, true));
  world.state.owners.set(TOKEN_ID, owner);
  return world;
}

/** A run whose transactions depart from flow/allowed.ts once checked with `connected` as sender. */
const departing: Array<[string, () => Chain, LiquidityRequestLike, Address]> = [
  ["a seed whose mint pays another account", () => chain(), seedRequest({ owner: stranger }), owner],
  [
    "a remove whose collect, inside its multicall, pays another account",
    removeChain,
    removeRequest({ owner: stranger }),
    owner,
  ],
  ["a seed reviewed by the owner while another account is connected", () => chain(), seedRequest(), stranger],
];

const halted = (driver: Parameters<typeof progressOf>[0]) =>
  vi.waitFor(() => expect(progressOf(driver).stage).toBe("halted"), { timeout: 3_000 });

describe("createLiquidityRun checking each transaction against the allow-list before its prompt (L13)", () => {
  it.each(departing)("halts %s as unlisted", async (_, world, request, connected) => {
    const fake = world();
    const sends = gateway(fake, connected);
    const { driver } = driverOn({
      world: fake,
      gateway: sends,
      wallet: wallet(fake, connected),
      request,
      account: () => connected,
    });

    driver.start();
    await halted(driver);

    expect(progressOf(driver).failure?.reason).toBe("unlisted");
  });

  it.each(departing)("prompts for no departing transaction of %s", async (_, world, request, connected) => {
    const fake = world();
    const sends = gateway(fake, connected);
    const { driver } = driverOn({
      world: fake,
      gateway: sends,
      wallet: wallet(fake, connected),
      request,
      account: () => connected,
    });

    driver.start();
    await halted(driver);

    const departed = sends.prompts.filter(
      (tx) => departures({ tx, session: SESSION, owner: connected, from: connected }).length > 0,
    );
    expect(departed).toEqual([]);
  });

  it.each(departing)("stores no send for the departing transaction of %s", async (_, world, request, connected) => {
    const fake = world();
    const sends = gateway(fake, connected);
    const { driver, store, flowId } = driverOn({
      world: fake,
      gateway: sends,
      wallet: wallet(fake, connected),
      request,
      account: () => connected,
    });

    driver.start();
    await halted(driver);

    const held = storedSends(store, flowId);
    expect(held.some((step) => step.outcome.status === "awaiting-signature")).toBe(false);
    expect(held).toHaveLength(sends.prompts.length);
  });

  it.each(departing)("sends no atomic batch for %s", async (_, world, request, connected) => {
    const fake = world();
    const sends = gateway(fake, connected);
    const batch = wallet(fake, connected, { atomic: "supported" });
    const { driver, store, flowId } = driverOn({
      world: fake,
      gateway: sends,
      wallet: batch,
      request,
      account: () => connected,
    });

    driver.start();
    await halted(driver);

    expect(progressOf(driver).failure?.reason).toBe("unlisted");
    expect(batch.sendCalls).toEqual([]);
    expect(sends.prompts).toEqual([]);
    expect(storedSends(store, flowId)).toEqual([]);
  });

  it("prompts for a run whose every transaction keeps to the allow-list", async () => {
    const fake = chain();
    const sends = gateway(fake, owner);
    const { driver } = driverOn({ world: fake, gateway: sends, wallet: wallet(fake, owner), request: seedRequest() });

    driver.start();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("complete"), { timeout: 3_000 });

    expect(sends.prompts.length).toBeGreaterThan(0);
    for (const tx of sends.prompts) expect(departures({ tx, session: SESSION, owner, from: owner })).toEqual([]);
  });
});
