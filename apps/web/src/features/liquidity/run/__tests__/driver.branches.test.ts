import { afterEach, describe, expect, it, vi } from "vitest";

import { DEPTH, live } from "./support/requests";
import { chain, disposeDrivers, driverOn, gateway, progressOf, sameTx, wallet } from "./support/world";
import { branch, owner, session, txsOf } from "../../flow/__tests__/support/session";
import { planSeed } from "../../flow/plan";
import type { SeedInput } from "../../types";

afterEach(disposeDrivers);

const TWO = session([branch(1), branch(2)]);

const input: SeedInput = {
  session: TWO,
  owner,
  total: DEPTH,
  collateral: "sDAI",
  chainTime: 1_900_000_000n,
  branches: TWO.branches.map(() => ({
    depth: DEPTH,
    upPriceBps: 5_000n,
    pools: { up: { status: "missing" }, down: { status: "missing" } },
  })),
};

describe("createLiquidityRun seeding a session of two branches (L10)", () => {
  it("is not stopped by the pools its own first branch seeded", async () => {
    const plan = planSeed(input);
    const firstSeed = plan.steps.find((step) => step.id === "branch:0:seed")!.tx!;
    const [first] = TWO.branches;
    const fake = chain();
    const sends = gateway(fake, owner, {
      onBroadcast: (tx) => {
        if (!sameTx(tx, firstSeed)) return;
        fake.setPool(first!.upToken, first!.outcome, live(5_000n, true));
        fake.setPool(first!.downToken, first!.outcome, live(5_000n, false));
      },
    });
    const { driver } = driverOn({
      world: fake,
      gateway: sends,
      wallet: wallet(fake, owner),
      request: { kind: "seed", input },
    });

    driver.start();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("complete"), { timeout: 3_000 });

    expect(sends.prompts).toEqual(txsOf(plan.steps));
  });

  it("stops for a new review when another branch's pool moves after the first branch seeded", async () => {
    const plan = planSeed(input);
    const firstSeed = plan.steps.find((step) => step.id === "branch:0:seed")!.tx!;
    const [, second] = TWO.branches;
    const fake = chain();
    const sends = gateway(fake, owner, {
      onBroadcast: (tx) => {
        if (sameTx(tx, firstSeed)) fake.setPool(second!.upToken, second!.outcome, live(4_000n, true));
      },
    });
    const { driver } = driverOn({
      world: fake,
      gateway: sends,
      wallet: wallet(fake, owner),
      request: { kind: "seed", input },
    });

    driver.start();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("moved"), { timeout: 3_000 });

    expect(sends.prompts.some((tx) => sameTx(tx, plan.steps.find((step) => step.id === "branch:1:seed")!.tx!))).toBe(
      false,
    );
  });
});
