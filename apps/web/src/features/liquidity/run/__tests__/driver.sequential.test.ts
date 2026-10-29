import type { FlowTx } from "@foresight/tx-orchestrator";
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TOKEN_ID,
  TOKENS,
  live,
  mergeInput,
  mergeRequest,
  mergeTxs,
  removeInput,
  removeRequest,
  removeTx,
  seedInput,
  seedRequest,
  seedTxs,
} from "./support/requests";
import {
  chain,
  copyStorage,
  disposeDrivers,
  driverOn,
  gateway,
  movesMoney,
  progressOf,
  settled,
  storedRun,
  timesBroadcast,
  wallet,
  type Chain,
  type LiquidityRequestLike,
  type PromptScript,
} from "./support/world";
import { owner } from "../../flow/__tests__/support/session";

afterEach(disposeDrivers);

/** A chain holding the position `removeRequest` withdraws, owned by the connected account, in a live pool. */
function removeChain(): Chain {
  const world = chain();
  world.setPool(TOKENS.upToken, TOKENS.outcome, live(5_000n, true));
  world.state.owners.set(TOKEN_ID, owner);
  return world;
}

const runs: Array<[string, () => Chain, LiquidityRequestLike, FlowTx[]]> = [
  ["a seed", () => chain(), seedRequest(), seedTxs(seedInput())],
  ["a remove", removeChain, removeRequest(), [removeTx(removeInput())]],
  [
    "a remove of two positions",
    () => {
      const world = removeChain();
      world.state.owners.set(TOKEN_ID + 1n, owner);
      return world;
    },
    removeRequest({ tokenIds: [TOKEN_ID, TOKEN_ID + 1n] }),
    [removeTx(removeInput({ tokenIds: [TOKEN_ID, TOKEN_ID + 1n] }))],
  ],
  ["a merge", () => chain(), mergeRequest(), mergeTxs(mergeInput())],
];

const complete = (driver: { getProgress(): unknown }) =>
  vi.waitFor(() => expect(progressOf(driver as never).stage).toBe("complete"), { timeout: 3_000 });

describe("createLiquidityRun running a plan one transaction at a time", () => {
  it.each(runs)("sends %s's planned transactions in order, each once", async (_, world, request, planned) => {
    const fake = world();
    const sends = gateway(fake, owner);
    const { driver } = driverOn({ world: fake, gateway: sends, wallet: wallet(fake, owner), request });

    driver.start();
    await complete(driver);

    expect(sends.prompts).toEqual(planned);
    expect(timesBroadcast(fake, planned)).toEqual(planned.map(() => 1));
  });

  it("stores the run under the liquidity-flow adapter", async () => {
    const fake = chain();
    const sends = gateway(fake, owner, { script: () => "hang" });
    const { driver, store, flowId } = driverOn({
      world: fake,
      gateway: sends,
      wallet: wallet(fake, owner),
      request: seedRequest(),
    });

    driver.start();
    await sends.held();

    expect(storedRun(store, flowId)?.adapterId).toBe("liquidity-flow");
  });

  it.each(runs)("has every send of %s stored before the wallet is asked for it", async (_, world, request, planned) => {
    const fake = world();
    const seenAtPrompt: Array<{ stored: boolean; awaiting: number; held: number }> = [];
    let read: () => ReturnType<typeof storedRun> = () => null;
    const sends = gateway(fake, owner, {
      script: () => {
        const run = read();
        const steps = run?.steps ?? [];
        seenAtPrompt.push({
          stored: run !== null,
          awaiting: steps.filter((step) => step.outcome.status === "awaiting-signature").length,
          held: steps.filter((step) => step.outcome.status !== "pending" && step.outcome.status !== "skipped").length,
        });
        return "sign";
      },
    });
    const { driver, store, flowId } = driverOn({ world: fake, gateway: sends, wallet: wallet(fake, owner), request });
    read = () => storedRun(store, flowId);

    driver.start();
    await complete(driver);

    // at the n-th prompt the n earlier sends are banked and this one is stored as asked for
    expect(seenAtPrompt).toEqual(planned.map((__, n) => ({ stored: true, awaiting: 1, held: n + 1 })));
  });
});

describe("createLiquidityRun across retry, reload and recovery (L8)", () => {
  const seedPlanned = seedTxs(seedInput());
  const moneyAt = seedPlanned.flatMap((tx, index) => (movesMoney(tx) ? [index] : []));

  it.each(moneyAt)("retries after the visitor refuses send %i, sending nothing twice", async (refused) => {
    const fake = chain();
    let refusals = 0;
    const sends = gateway(fake, owner, {
      script: (index) => (index === refused && refusals++ === 0 ? "reject" : "sign"),
    });
    const { driver } = driverOn({ world: fake, gateway: sends, wallet: wallet(fake, owner), request: seedRequest() });

    driver.start();
    await settled(driver);
    driver.retry();
    await complete(driver);

    expect(timesBroadcast(fake, seedPlanned)).toEqual(seedPlanned.map(() => 1));
  });

  it.each(runs)(
    "finishes %s after a reload that left a broadcast send unmined, without sending it again",
    async (_, world, request, planned) => {
      const fake = world();
      const last = planned.length - 1;
      const first = gateway(fake, owner, { script: (index) => (index === last ? "unmined" : "sign") });
      const tab = driverOn({ world: fake, gateway: first, wallet: wallet(fake, owner), request });
      tab.driver.start();
      await vi.waitFor(() => expect(fake.broadcasts).toHaveLength(planned.length));
      const left = copyStorage(tab.storage);
      tab.driver.dispose();
      fake.land();

      const second = gateway(fake, owner);
      const { driver } = driverOn({
        world: fake,
        gateway: second,
        wallet: wallet(fake, owner),
        request,
        storage: left,
      });
      driver.recover();
      await vi.waitFor(() => expect(["review", "complete"]).toContain(progressOf(driver).stage));
      if (progressOf(driver).stage === "review") driver.resume();
      await complete(driver);

      expect(second.prompts).toEqual([]);
      expect(timesBroadcast(fake, planned)).toEqual(planned.map(() => 1));
    },
  );

  it.each(runs)(
    "never sends a money-moving step of %s twice when its prompt was approved after the tab closed",
    async (_, world, request, planned) => {
      const fake = world();
      const target = planned.map(movesMoney).lastIndexOf(true);
      const first = gateway(fake, owner, { script: (index) => (index === target ? "hang" : "sign") });
      const tab = driverOn({ world: fake, gateway: first, wallet: wallet(fake, owner), request });
      tab.driver.start();
      await first.held();
      const left = copyStorage(tab.storage);
      tab.driver.dispose();
      fake.approveLater(first.hung[0]!, owner);

      const second = gateway(fake, owner);
      const { driver } = driverOn({
        world: fake,
        gateway: second,
        wallet: wallet(fake, owner),
        request,
        storage: left,
      });
      driver.recover();
      await settled(driver);
      if (progressOf(driver).stage === "review") driver.resume();
      await settled(driver);
      driver.retry();
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(timesBroadcast(fake, planned.filter(movesMoney)).every((times) => times <= 1)).toBe(true);
    },
  );

  // thirty interrupted runs, each with a reload, at about 160ms a run
  it("sends no split, mint, withdrawal or merge twice, wherever a seed is interrupted and however it comes back", async () => {
    const modes: PromptScript[] = ["reject", "hang", "unmined"];
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: seedPlanned.length - 1 }),
        fc.constantFrom(...modes),
        fc.boolean(),
        async (at, mode, approvedAfterClose) => {
          const fake = chain();
          const first = gateway(fake, owner, { script: (index) => (index === at ? mode : "sign") });
          const tab = driverOn({ world: fake, gateway: first, wallet: wallet(fake, owner), request: seedRequest() });
          tab.driver.start();
          if (mode === "hang") await first.held();
          else await vi.waitFor(() => expect(first.prompts.length).toBeGreaterThan(at));
          await new Promise((resolve) => setTimeout(resolve, 5));
          const left = copyStorage(tab.storage);
          tab.driver.dispose();
          if (mode === "hang" && approvedAfterClose) fake.approveLater(first.hung[0]!, owner);
          fake.land();

          const second = gateway(fake, owner);
          const { driver } = driverOn({
            world: fake,
            gateway: second,
            wallet: wallet(fake, owner),
            request: seedRequest(),
            storage: left,
          });
          driver.recover();
          await settled(driver);
          if (progressOf(driver).stage === "review") driver.resume();
          await settled(driver);
          if (progressOf(driver).stage === "halted") driver.retry();
          await settled(driver);

          const times = timesBroadcast(fake, seedPlanned.filter(movesMoney));
          expect(times.every((count) => count <= 1)).toBe(true);
          driver.dispose();
        },
      ),
      { numRuns: 30 },
    );
  }, 20_000);
});
