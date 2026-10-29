import { afterEach, describe, expect, it, vi } from "vitest";

import { seedInput, seedRequest, seedTxs } from "./support/requests";
import {
  chain,
  disposeDrivers,
  driverOn,
  gateway,
  movesMoney,
  progressOf,
  sameTx,
  settled,
  storedRun,
  wallet,
} from "./support/world";
import { owner } from "../../flow/__tests__/support/session";

afterEach(disposeDrivers);

const PLANNED = seedTxs(seedInput());
const SPLIT_AT = PLANNED.findIndex(movesMoney);

describe("createLiquidityRun with the same run open in another tab", () => {
  it("does not ask for a send another tab stored after this tab restored the run (L8)", async () => {
    const fake = chain();
    // tab A signs up to the split, whose prompt it leaves open
    const first = gateway(fake, owner, { script: (index) => (index === 0 ? "hang" : "sign") });
    const tabA = driverOn({ world: fake, gateway: first, wallet: wallet(fake, owner), request: seedRequest() });
    tabA.driver.start();
    await first.held();
    fake.approveLater(first.hung[0]!, owner);
    fake.land();

    // tab B restores the run from the shared storage while it holds only step 0's send
    const second = gateway(fake, owner);
    const tabB = driverOn({
      world: fake,
      gateway: second,
      wallet: wallet(fake, owner),
      request: seedRequest(),
      storage: tabA.storage,
    });
    tabB.driver.recover();
    await settled(tabB.driver);

    // tab A goes on to store the split's send, as it does before its prompt opens
    const stored = storedRun(tabA.store, tabA.flowId)!;
    const snapshot = stored.snapshot as { sends: Record<string, unknown> };
    const splitId = stored.steps[SPLIT_AT]!.stepId;
    snapshot.sends[splitId] = { tx: PLANNED[SPLIT_AT], nonce: 1, fromBlock: 0n };
    tabA.store.save(stored);

    if (progressOf(tabB.driver).stage === "review") tabB.driver.resume();
    await vi.waitFor(() => expect(["halted", "complete"]).toContain(progressOf(tabB.driver).stage));

    expect(second.prompts.some((tx) => sameTx(tx, PLANNED[SPLIT_AT]!))).toBe(false);
  });
});
