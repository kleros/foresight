import { afterEach, describe, expect, it, vi } from "vitest";

import { DEPTH, TOKEN_ID, TOKENS, live, mergeInput, mergeRequest, removeRequest } from "./support/requests";
import {
  chain,
  copyStorage,
  disposeDrivers,
  driverOn,
  gateway,
  wallet,
  type Chain,
  type LiquidityDriverLike,
  type PromptScript,
} from "./support/world";
import { branch, decode, owner, session } from "../../flow/__tests__/support/session";
import { planMerge, planSeed } from "../../flow/plan";
import type { LiquidityRequest, SeedInput } from "../../types";

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
const SEED: LiquidityRequest = { kind: "seed", input };

/** The plan's step ids, which the popup's rows group: the parent split, then each branch's own steps. */
const IDS = planSeed(input).steps.map((step) => step.id);
const TOTAL = IDS.length;
const countOf = (prefix: string) => IDS.filter((id) => id.startsWith(prefix)).length;
const PARENT = countOf("parent:");
const BRANCH_0 = countOf("branch:0:");
const BRANCH_1 = countOf("branch:1:");
/** The second branch's first prompt, from 0. */
const SECOND_BRANCH_AT = IDS.findIndex((id) => id.startsWith("branch:1:"));

const progress = (driver: LiquidityDriverLike) => driver.getProgress();
const rowViews = (driver: LiquidityDriverLike) => progress(driver).rows.map((row) => [row.id, row.view]);
const atStage = (driver: LiquidityDriverLike, stage: string) =>
  vi.waitFor(() => expect(progress(driver).stage).toBe(stage), { timeout: 3_000 });

function seedRun(script: (index: number) => PromptScript, fake: Chain = chain()) {
  const sends = gateway(fake, owner, { script });
  const tab = driverOn({ world: fake, gateway: sends, wallet: wallet(fake, owner), request: SEED });
  tab.driver.start();
  return { fake, sends, ...tab };
}

describe("a seed's progress, read from the run's steps", () => {
  it("names the signature the wallet waits on, out of the plan's total", async () => {
    const { driver, sends } = seedRun((index) => (index === SECOND_BRANCH_AT ? "hang" : "sign"));

    await sends.held();

    expect(progress(driver)).toMatchObject({
      stage: "signing",
      signatures: { done: SECOND_BRANCH_AT, total: TOTAL },
      signature: { position: SECOND_BRANCH_AT + 1, total: TOTAL, status: "awaiting-signature" },
    });
    expect(rowViews(driver)).toEqual([
      ["parent", "done"],
      ["branch:0", "done"],
      ["branch:1", "running"],
    ]);
  });

  it("gives each row its own signatures, done and planned", async () => {
    const { driver, sends } = seedRun((index) => (index === SECOND_BRANCH_AT ? "hang" : "sign"));

    await sends.held();

    expect(progress(driver).rows.map((row) => row.signatures)).toEqual([
      { done: PARENT, total: PARENT },
      { done: BRANCH_0, total: BRANCH_0 },
      { done: 0, total: BRANCH_1 },
    ]);
  });

  it("says the signature is confirming once its transaction is broadcast, and moves on once it mines", async () => {
    const { driver, fake } = seedRun((index) => (index === SECOND_BRANCH_AT ? "unmined" : "sign"));

    await atStage(driver, "confirming");
    expect(progress(driver).signature).toEqual({
      position: SECOND_BRANCH_AT + 1,
      total: TOTAL,
      status: "submitted",
    });
    expect(rowViews(driver)).toContainEqual(["branch:1", "running"]);

    fake.land();
    await atStage(driver, "complete");

    expect(progress(driver).signatures).toEqual({ done: TOTAL, total: TOTAL });
    expect(progress(driver).signature).toBeUndefined();
    expect(rowViews(driver)).toEqual([
      ["parent", "done"],
      ["branch:0", "done"],
      ["branch:1", "done"],
    ]);
  });

  it("marks the row a declined signature stopped, keeping the rows before it done", async () => {
    const { driver } = seedRun((index) => (index === SECOND_BRANCH_AT ? "reject" : "sign"));

    await atStage(driver, "halted");

    expect(rowViews(driver)).toEqual([
      ["parent", "done"],
      ["branch:0", "done"],
      ["branch:1", "failed"],
    ]);
    expect(progress(driver).signature).toBeUndefined();
  });

  it("marks the first row when the parent split's first signature is declined", async () => {
    const { driver } = seedRun((index) => (index === 0 ? "reject" : "sign"));

    await atStage(driver, "halted");

    expect(rowViews(driver)).toEqual([
      ["parent", "failed"],
      ["branch:0", "idle"],
      ["branch:1", "idle"],
    ]);
  });

  it("names the seed's kind", async () => {
    const { driver, sends } = seedRun(() => "hang");

    await sends.held();

    expect(progress(driver).kind).toBe("seed");
  });
});

/** A seed left with its second branch's first prompt open when its tab closed, and a second tab on what it stored. */
async function reopened() {
  const fake = chain();
  const first = seedRun((index) => (index === SECOND_BRANCH_AT ? "hang" : "sign"), fake);
  await first.sends.held();
  const left = copyStorage(first.storage);
  first.driver.dispose();
  const { driver } = driverOn({
    world: fake,
    gateway: gateway(fake, owner),
    wallet: wallet(fake, owner),
    request: SEED,
    storage: left,
  });
  return driver;
}

describe("a recovered seed's progress", () => {
  it("shows the rows the stored run settled as done while it waits for review", async () => {
    const driver = await reopened();

    driver.recover();
    await atStage(driver, "review");

    expect(rowViews(driver)).toEqual([
      ["parent", "done"],
      ["branch:0", "done"],
      ["branch:1", "idle"],
    ]);
    expect(progress(driver).signatures).toEqual({ done: SECOND_BRANCH_AT, total: TOTAL });
  });

  it("crosses no row when it stops on a prompt that may still be answered", async () => {
    const driver = await reopened();
    driver.recover();
    await atStage(driver, "review");

    driver.resume();
    await vi.waitFor(() => expect(progress(driver).failure?.reason).toBe("held"), { timeout: 3_000 });

    expect(rowViews(driver)).toEqual([
      ["parent", "done"],
      ["branch:0", "done"],
      ["branch:1", "idle"],
    ]);
  });
});

describe("an atomic seed's progress", () => {
  it("is one signature, with every row running while the wallet holds the batch", async () => {
    const fake = chain();
    const batch = wallet(fake, owner, { atomic: "supported", sendCalls: "hang" });
    const { driver } = driverOn({ world: fake, gateway: gateway(fake, owner), wallet: batch, request: SEED });

    driver.start();
    await batch.sent();

    expect(progress(driver)).toMatchObject({
      atomic: true,
      signatures: { done: 0, total: 1 },
      signature: { position: 1, total: 1, status: "awaiting-signature" },
    });
    expect(rowViews(driver)).toEqual([
      ["parent", "running"],
      ["branch:0", "running"],
      ["branch:1", "running"],
    ]);
  });
});

describe("a remove's progress", () => {
  function removeRun(script: PromptScript) {
    const fake = chain();
    fake.setPool(TOKENS.upToken, TOKENS.outcome, live(5_000n, true));
    fake.state.owners.set(TOKEN_ID, owner);
    const sends = gateway(fake, owner, { script: () => script });
    const { driver } = driverOn({ world: fake, gateway: sends, wallet: wallet(fake, owner), request: removeRequest() });
    driver.start();
    return { driver, sends };
  }

  it("is one row and one signature while the wallet waits", async () => {
    const { driver, sends } = removeRun("hang");

    await sends.held();

    expect(progress(driver)).toMatchObject({
      kind: "remove",
      signature: { position: 1, total: 1, status: "awaiting-signature" },
    });
    expect(progress(driver).rows).toEqual([{ id: "remove", view: "running", signatures: { done: 0, total: 1 } }]);
  });

  it("marks its row done once it lands", async () => {
    const { driver } = removeRun("sign");

    await atStage(driver, "complete");

    expect(rowViews(driver)).toEqual([["remove", "done"]]);
  });

  it("marks its row stopped when it reverts", async () => {
    const { driver } = removeRun("revert");

    await atStage(driver, "halted");

    expect(rowViews(driver)).toEqual([["remove", "failed"]]);
  });
});

describe("a merge's progress", () => {
  /** The branch merge's transactions are its approvals and the merge itself; the parent's follow. */
  const txs = planMerge(mergeInput()).txs;
  const BRANCH_MERGE = txs.findIndex((tx) => decode(tx).kind === "merge") + 1;
  const PARENT_MERGE = txs.length - BRANCH_MERGE;

  function mergeRun(script: (index: number) => PromptScript) {
    const fake = chain();
    const sends = gateway(fake, owner, { script });
    const { driver } = driverOn({ world: fake, gateway: sends, wallet: wallet(fake, owner), request: mergeRequest() });
    driver.start();
    return { driver, sends };
  }

  it("has a row for the branch's merge and one for the parent's, each with its own signatures", async () => {
    expect(PARENT_MERGE).toBeGreaterThan(0);
    const { driver, sends } = mergeRun((index) => (index === BRANCH_MERGE ? "hang" : "sign"));

    await sends.held();

    expect(progress(driver).kind).toBe("merge");
    expect(progress(driver).rows).toEqual([
      { id: "branch:0", view: "done", signatures: { done: BRANCH_MERGE, total: BRANCH_MERGE } },
      { id: "parent", view: "running", signatures: { done: 0, total: PARENT_MERGE } },
    ]);
    expect(progress(driver).signature).toEqual({
      position: BRANCH_MERGE + 1,
      total: txs.length,
      status: "awaiting-signature",
    });
  });

  it("marks the branch's row when its first approval is declined", async () => {
    const { driver } = mergeRun((index) => (index === 0 ? "reject" : "sign"));

    await atStage(driver, "halted");

    expect(rowViews(driver)).toEqual([
      ["branch:0", "failed"],
      ["parent", "idle"],
    ]);
  });
});

describe("progress before any run", () => {
  it("has no rows and no signatures", () => {
    const fake = chain();
    const { driver } = driverOn({ world: fake, gateway: gateway(fake, owner), wallet: wallet(fake, owner), request: SEED });

    expect(progress(driver)).toEqual({ stage: "idle", rows: [], signatures: { done: 0, total: 0 } });
  });
});
