import { createTestIndexer } from "envio";
import { describe, it } from "vitest";

import {
  CHILD_MARKET,
  DOWN,
  EXECUTOR,
  executorDeployed,
  indexEvents,
  OTHER_DOWN,
  OTHER_MARKET,
  OTHER_UNDERLYING,
  OTHER_UP,
  OWNER,
  UNDERLYING,
  UP,
} from "../support/harness";
import { inTx, parentRedeemLogs, type RedeemOption, seedSession } from "../support/redeem";

/** One payout from Seer's router for several parent outcomes: each outcome's part, as Seer floors it. */

const OPTION_A: RedeemOption = {
  market: CHILD_MARKET,
  parentOutcomeIndex: 0,
  parentToken: UNDERLYING,
  down: DOWN,
  up: UP,
  invalid: "0x0000000000000000000000000000000000000119",
};
const OPTION_B: RedeemOption = {
  market: OTHER_MARKET,
  parentOutcomeIndex: 1,
  parentToken: OTHER_UNDERLYING,
  down: OTHER_DOWN,
  up: OTHER_UP,
  invalid: "0x0000000000000000000000000000000000000219",
};

const REDEEM_TX = "0x00000000000000000000000000000000000000000000000000000000000000a1";

async function payouts(amounts: [bigint, bigint], payout: bigint) {
  const indexer = createTestIndexer();
  await seedSession(indexer, [OPTION_A, OPTION_B]);
  const pulled = [
    { token: UNDERLYING, amount: amounts[0] },
    { token: OTHER_UNDERLYING, amount: amounts[1] },
  ];
  await indexEvents(indexer, [
    executorDeployed(OWNER, EXECUTOR),
    ...parentRedeemLogs(EXECUTOR, pulled, payout).map((log) => inTx(REDEEM_TX, log)),
  ]);
  return (await indexer.Redeem.getAll())
    .map((row) => [row.parentOutcomeIndex, row.payout] as const)
    .sort(([a], [b]) => Number(a - b));
}

describe("a parent redeem of two winning outcomes", () => {
  it("pays each outcome its own floor at the winners' shared fraction", async (t) => {
    // two winners at 1/2 each: 5 pay 2 and 3 pay 1, where the amounts alone would split 3 as 1 and 2
    t.expect(await payouts([5n, 3n], 3n)).toEqual([
      [0n, 2n],
      [1n, 1n],
    ]);
  });

  it("splits by the amounts when no shared fraction gives the payout", async (t) => {
    t.expect(await payouts([5n, 3n], 7n)).toEqual([
      [0n, 4n],
      [1n, 3n],
    ]);
  });
});
