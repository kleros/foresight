import { createTestIndexer, type TestIndexerProcessConfig } from "envio";
import { describe, it } from "vitest";

import { GNOSIS_ROUTER } from "../../src/utils/routers";
import {
  BLOCK,
  CHILD_MARKET,
  DOWN,
  EXECUTOR,
  executorDeployed,
  OTHER_DOWN,
  OTHER_MARKET,
  OTHER_UNDERLYING,
  OTHER_UP,
  OWNER,
  transfer,
  UNDERLYING,
  UP,
} from "../support/harness";
import { childSplitLogs, hashOf, ledgerOf, splitLogs, tx } from "../support/ledger";
import { PARENT_INVALID, type RedeemOption, seedSession, SESSION_ID } from "../support/redeem";

/** Which of a trade wallet's parent splits are prediction cost, from what the same transaction shows. */

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

type Indexer = ReturnType<typeof createTestIndexer>;
type Simulated = NonNullable<NonNullable<TestIndexerProcessConfig["chains"][31337]>["simulate"]>;

const run = (indexer: Indexer, simulate: Simulated) => indexer.process({ chains: { 31337: { simulate } } });

async function seeded() {
  const indexer = createTestIndexer();
  await seedSession(indexer, [OPTION_A, OPTION_B]);
  return indexer;
}

describe("what pays for a split", () => {
  const xdaiSplit = (amount: bigint, block: number) =>
    PARENT_TOKENS.map((token) => transfer(token, GNOSIS_ROUTER, EXECUTOR, amount, block));

  it("charges a credits split that comes before its batch's sDAI split", async (t) => {
    const indexer = await seeded();
    await run(indexer, [
      executorDeployed(OWNER, EXECUTOR),
      ...tx(hashOf(1), [...xdaiSplit(50n, BLOCK + 2), ...splitLogs(EXECUTOR, PARENT_TOKENS, 100n)]),
    ]);

    t.expect(ledgerOf(await indexer.SessionMove.getAll()).costs).toEqual({ [SESSION_ID]: 150n });
    t.expect(await indexer.SplitMint.getAll()).toEqual([]);
  });

  it("leaves a liquidity seed's split out of the cost of a later prediction", async (t) => {
    const indexer = await seeded();
    await run(indexer, [
      executorDeployed(OWNER, EXECUTOR),
      ...tx(hashOf(1), xdaiSplit(70n, BLOCK + 2)),
      ...tx(hashOf(2), [...xdaiSplit(40n, BLOCK + 3), ...childSplitLogs(EXECUTOR, OPTION_A, 10n, BLOCK + 3)]),
    ]);

    t.expect(ledgerOf(await indexer.SessionMove.getAll()).costs).toEqual({ [SESSION_ID]: 40n });
  });
});
