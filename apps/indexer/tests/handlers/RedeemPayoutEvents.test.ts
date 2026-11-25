import { createTestIndexer, type TestIndexerProcessConfig } from "envio";
import { type Address, type Hex } from "viem";
import { describe, it } from "vitest";

import { CONDITIONAL_ROUTER, GNOSIS_ROUTER } from "../../src/utils/routers";
import {
  BLOCK,
  CHILD_MARKET,
  DOWN,
  EXECUTOR,
  executorDeployed,
  OTHER_DOWN,
  OTHER_MARKET,
  OTHER_OWNER,
  OTHER_UNDERLYING,
  OTHER_UP,
  OWNER,
  SDAI,
  transfer,
  UNDERLYING,
  UP,
} from "../support/harness";
import { childSplitLogs, CTF, hashOf, ledgerOf, splitLogs, tx } from "../support/ledger";
import { PARENT_INVALID, type RedeemOption, seedSession, SESSION_ID } from "../support/redeem";

/**
 * Redeems as ConditionalTokens reports them: every `redeemPositions` call emits PayoutRedemption with the router as
 * redeemer, and the routers send collateral only when the payout is above zero.
 */

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
const PARENT_TOKENS = [UNDERLYING, OTHER_UNDERLYING, PARENT_INVALID] as const;
const ROOT_COLLECTION: Hex = `0x${"00".repeat(32)}`;
const CHILD_COLLECTION: Hex = `0x${"0c".repeat(32)}`;
const REDEEM_BLOCK = BLOCK + 10;

type Indexer = ReturnType<typeof createTestIndexer>;
type Simulated = NonNullable<NonNullable<TestIndexerProcessConfig["chains"][31337]>["simulate"]>;

const run = (indexer: Indexer, simulate: Simulated) => indexer.process({ chains: { 31337: { simulate } } });

const redemption = (redeemer: Address, parentCollectionId: Hex, payout: bigint) => ({
  contract: "ConditionalTokens" as const,
  event: "PayoutRedemption" as const,
  srcAddress: CTF,
  block: { number: REDEEM_BLOCK, timestamp: REDEEM_BLOCK },
  params: {
    redeemer,
    collateralToken: SDAI,
    parentCollectionId,
    conditionId: `0x${"cc".repeat(32)}`,
    indexSets: [1n],
    payout,
  },
});

const redeemRows = async (indexer: Indexer) =>
  (await indexer.Redeem.getAll())
    .map((row) => [row.account, row.childMarket_id ?? null, row.parentOutcomeIndex, row.payout] as const)
    .sort((a, b) => String(a).localeCompare(String(b)));

async function seeded() {
  const indexer = createTestIndexer();
  await seedSession(indexer, [OPTION_A, OPTION_B]);
  return indexer;
}

describe("a redeem that pays nothing", () => {
  it.for([
    ["a trade wallet", EXECUTOR],
    ["a connected wallet", OWNER],
  ] as const)("records %s's child redeem through the conditional router at 0", async ([, holder], t) => {
    const indexer = await seeded();
    await run(indexer, [
      executorDeployed(OTHER_OWNER, EXECUTOR),
      ...tx(hashOf(1), [
        transfer(DOWN, holder, CONDITIONAL_ROUTER, 10n, REDEEM_BLOCK),
        redemption(CONDITIONAL_ROUTER, CHILD_COLLECTION, 0n),
      ]),
    ]);

    t.expect(await redeemRows(indexer)).toEqual([[holder, CHILD_MARKET, 0n, 0n]]);
    t.expect(await indexer.Prediction.getAll()).toEqual([]);
    t.expect(await indexer.RedeemPull.getAll()).toEqual([]);
  });

  it.for([
    ["a trade wallet", EXECUTOR],
    ["a connected wallet", OWNER],
  ] as const)("records %s's parent redeem through Seer's router at 0", async ([, holder], t) => {
    const indexer = await seeded();
    await run(indexer, [
      executorDeployed(OTHER_OWNER, EXECUTOR),
      ...tx(hashOf(1), [
        transfer(OTHER_UNDERLYING, holder, GNOSIS_ROUTER, 30n, REDEEM_BLOCK),
        redemption(GNOSIS_ROUTER, ROOT_COLLECTION, 0n),
      ]),
    ]);

    t.expect(await redeemRows(indexer)).toEqual([[holder, null, 1n, 0n]]);
    t.expect(await indexer.RedeemPull.getAll()).toEqual([]);
  });

  it("records a child redeem whose parent outcome pays nothing at 0", async (t) => {
    const indexer = await seeded();
    await run(
      indexer,
      tx(hashOf(1), [
        transfer(UP, OWNER, CONDITIONAL_ROUTER, 10n, REDEEM_BLOCK),
        redemption(CONDITIONAL_ROUTER, CHILD_COLLECTION, 7n),
        redemption(CONDITIONAL_ROUTER, ROOT_COLLECTION, 0n),
      ]),
    );

    t.expect(await redeemRows(indexer)).toEqual([[OWNER, CHILD_MARKET, 0n, 0n]]);
  });

  it("marks the trade wallet's redeemed tokens and leaves its cost as it was", async (t) => {
    const indexer = await seeded();
    await run(indexer, [
      executorDeployed(OWNER, EXECUTOR),
      ...tx(hashOf(1), [...splitLogs(EXECUTOR, PARENT_TOKENS, 300n), ...childSplitLogs(EXECUTOR, OPTION_A, 100n)]),
      ...tx(hashOf(2), [
        transfer(OTHER_UNDERLYING, EXECUTOR, GNOSIS_ROUTER, 300n, REDEEM_BLOCK),
        redemption(GNOSIS_ROUTER, ROOT_COLLECTION, 0n),
      ]),
    ]);

    const rows = await indexer.SessionMove.getAll();
    t.expect(ledgerOf(rows).costs).toEqual({ [SESSION_ID]: 300n });
    t.expect(rows.filter((row) => row.transactionHash === hashOf(2)).map((row) => row.redeemed)).toEqual([true]);
  });

  it("records a redeem that pays once, at the collateral the router sends", async (t) => {
    const indexer = await seeded();
    await run(
      indexer,
      tx(hashOf(1), [
        transfer(UP, OWNER, CONDITIONAL_ROUTER, 80n, REDEEM_BLOCK),
        redemption(CONDITIONAL_ROUTER, CHILD_COLLECTION, 60n),
        redemption(CONDITIONAL_ROUTER, ROOT_COLLECTION, 60n),
        transfer(SDAI, CONDITIONAL_ROUTER, OWNER, 60n, REDEEM_BLOCK),
      ]),
    );

    t.expect(await redeemRows(indexer)).toEqual([[OWNER, CHILD_MARKET, 0n, 60n]]);
  });
});
