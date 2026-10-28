import type { FlowTx } from "@foresight/tx-orchestrator";
import { afterEach, describe, expect, it, vi } from "vitest";

import { seedInput, seedRequest, seedTxs } from "./support/requests";
import {
  chain,
  copyStorage,
  disposeDrivers,
  driverOn,
  gateway,
  movesMoney,
  progressOf,
  sameTx,
  settled,
  timesBroadcast,
  wallet,
  type Chain,
} from "./support/world";
import { owner, stranger } from "../../flow/__tests__/support/session";

afterEach(disposeDrivers);

const T0 = 1_700_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1_000;
const PLANNED = seedTxs(seedInput());
/** The parent split: the seed's first send that moves money. */
const SPLIT_AT = PLANNED.findIndex(movesMoney);

/** A seed whose prompt `at` was open, and never answered in that tab, when the tab closed. */
async function leftOpen(at = SPLIT_AT) {
  const fake = chain();
  const first = gateway(fake, owner, { script: (index) => (index === at ? "hang" : "sign") });
  const tab = driverOn({
    world: fake,
    gateway: first,
    wallet: wallet(fake, owner),
    request: seedRequest(),
    now: () => T0,
  });
  tab.driver.start();
  await first.held();
  const left = copyStorage(tab.storage);
  tab.driver.dispose();
  return { fake, left, hung: first.hung[0]! };
}

/** A second tab on `left`, recovered and resumed until it rests. */
async function reopened(fake: Chain, left: ReturnType<typeof copyStorage>, now = T0 + 1) {
  const sends = gateway(fake, owner);
  const { driver } = driverOn({
    world: fake,
    gateway: sends,
    wallet: wallet(fake, owner),
    request: seedRequest(),
    storage: left,
    now: () => now,
  });
  driver.recover();
  await vi.waitFor(() => expect(progressOf(driver).stage).toBe("review"));
  driver.resume();
  await settled(driver);
  return { driver, sends };
}

/** How many times `tx` mined without reverting. */
const landed = (fake: Chain, tx: FlowTx) =>
  fake.broadcasts.filter((sent) => sent.mined && !sent.reverted && sameTx(sent.tx, tx)).length;

describe("createLiquidityRun recovering a prompt open when its tab closed (L8)", () => {
  it("never signs it again, however long after, while the chain shows no send of it", async () => {
    const { fake, left } = await leftOpen();

    const { driver, sends } = await reopened(fake, left, T0 + DAY_MS);

    expect(progressOf(driver)).toEqual({ stage: "halted", failure: { reason: "held", retryable: true } });
    expect(sends.prompts).toEqual([]);
  });

  it("finishes without signing it again once the prompt was approved after the tab closed", async () => {
    const { fake, left, hung } = await leftOpen();
    fake.approveLater(hung, owner);

    const { driver, sends } = await reopened(fake, left);

    expect(progressOf(driver).stage).toBe("complete");
    expect(sends.prompts).toEqual(PLANNED.slice(SPLIT_AT + 1));
    expect(timesBroadcast(fake, PLANNED)).toEqual(PLANNED.map(() => 1));
  });

  const otherSends: Array<[string, (fake: Chain) => void]> = [
    ["a cancel at its nonce", (fake) => fake.broadcast({ to: owner, data: "0x", value: 0n }, owner, true)],
    ["an unrelated send from the account", (fake) => fake.broadcast({ to: stranger, data: "0x1234" }, owner, true)],
  ];

  it.each(otherSends)("halts needing the visitor, signing nothing, when %s took its nonce", async (_, send) => {
    const { fake, left, hung } = await leftOpen();
    send(fake);

    const { driver, sends } = await reopened(fake, left);

    expect(progressOf(driver)).toEqual({ stage: "halted", failure: { reason: "held", retryable: true } });
    expect(sends.prompts).toEqual([]);
    expect(timesBroadcast(fake, [hung])).toEqual([0]);
  });

  it("halts as reverted, signing nothing, when the prompt approved after the tab closed reverted", async () => {
    const { fake, left, hung } = await leftOpen();
    fake.broadcast(hung, owner, true, { reverted: true });

    const { driver, sends } = await reopened(fake, left);

    expect(progressOf(driver)).toEqual({ stage: "halted", failure: { reason: "reverted", retryable: false } });
    expect(sends.prompts).toEqual([]);
  });

  it("holds a send stored with only a nonce and a time, whose nonce a mined call of it took", async () => {
    const { fake, left, hung } = await leftOpen();
    const legacy = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(legacy);
      if (typeof value !== "object" || value === null) return value;
      return Object.fromEntries(
        Object.entries(value).map(([key, field]) =>
          key === "sends"
            ? [
                key,
                Object.fromEntries(
                  Object.entries(field as object).map(([id, send]) => [id, { nonce: send.nonce, heldAt: T0 }]),
                ),
              ]
            : [key, legacy(field)],
        ),
      );
    };
    for (const key of left.keys()) left.setItem(key, JSON.stringify(legacy(JSON.parse(left.getItem(key)!))));
    fake.approveLater(hung, owner);

    const { driver, sends } = await reopened(fake, left);

    expect(progressOf(driver)).toEqual({ stage: "halted", failure: { reason: "held", retryable: true } });
    expect(sends.prompts).toEqual([]);
  });

  // red-team probe P-o
  it("sends the parent split once when its prompt was approved after the tab closed and mined only before a retry", async () => {
    const { fake, left, hung } = await leftOpen();
    fake.broadcast(hung, owner, false);

    const { driver, sends } = await reopened(fake, left);
    expect(progressOf(driver)).toEqual({ stage: "halted", failure: { reason: "pending", retryable: true } });
    fake.land();
    driver.retry();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("complete"));

    expect(sends.prompts).toEqual(PLANNED.slice(SPLIT_AT + 1));
    expect(timesBroadcast(fake, PLANNED)).toEqual(PLANNED.map(() => 1));
  });
});

describe("createLiquidityRun after a send that did not do its work (L8)", () => {
  it("halts as reverted on reload, signing nothing, after a send reverted on chain", async () => {
    const fake = chain();
    const first = gateway(fake, owner, { script: (index) => (index === SPLIT_AT ? "revert" : "sign") });
    const tab = driverOn({ world: fake, gateway: first, wallet: wallet(fake, owner), request: seedRequest() });
    tab.driver.start();
    await vi.waitFor(() => expect(progressOf(tab.driver).failure?.reason).toBe("reverted"));
    const left = copyStorage(tab.storage);
    tab.driver.dispose();

    const { driver, sends } = await reopened(fake, left);

    expect(progressOf(driver)).toEqual({ stage: "halted", failure: { reason: "reverted", retryable: false } });
    expect(sends.prompts).toEqual([]);
  });

  it("asks again on retry for a send the wallet cancelled, and lands it once", async () => {
    const fake = chain();
    let cancels = 0;
    const sends = gateway(fake, owner, {
      script: (index) => (index === SPLIT_AT && cancels++ === 0 ? "cancel" : "sign"),
    });
    const { driver } = driverOn({ world: fake, gateway: sends, wallet: wallet(fake, owner), request: seedRequest() });
    driver.start();
    await vi.waitFor(() => expect(progressOf(driver).failure?.reason).toBe("cancelled"));

    driver.retry();
    await vi.waitFor(() => expect(progressOf(driver).stage).toBe("complete"));

    expect(PLANNED.map((tx) => landed(fake, tx))).toEqual(PLANNED.map(() => 1));
  });
});
