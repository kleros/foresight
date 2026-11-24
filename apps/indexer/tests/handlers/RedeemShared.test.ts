import { createTestIndexer } from "envio";
import { type Address } from "viem";
import { describe, it } from "vitest";

import {
  BLOCK,
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
  POOL,
  transfer,
  UNDERLYING,
  UP,
} from "../support/harness";
import {
  childRedeemLogs,
  GNOSIS_ROUTER,
  inTx,
  PARENT_INVALID,
  parentRedeemLogs,
  type RedeemOption,
  seedSession,
  SESSION_ID,
} from "../support/redeem";

/** Two sessions asking the same parent question, so they share its outcome tokens. */

type TestIndexer = ReturnType<typeof createTestIndexer>;

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

const LATER_SESSION = "8";
/** Session 8's child on option 0: its own question, priced against the shared parent token. */
const LATER_MARKET = "0x0000000000000000000000000000000000000c08" as const;
const LATER_DOWN = "0x0000000000000000000000000000000000000318" as const;
const LATER_UP = "0x0000000000000000000000000000000000000317" as const;
/** Session 8's child on option 1, asking session 7's question, so Seer hands it session 7's child tokens. */
const DUPLICATE_MARKET = "0x0000000000000000000000000000000000000c09" as const;

const REDEEM_TX = "0x00000000000000000000000000000000000000000000000000000000000000a1";
const TRADE_TX = "0x00000000000000000000000000000000000000000000000000000000000000b1";
const LATER_TRADE_TX = "0x00000000000000000000000000000000000000000000000000000000000000b2";
const MERGE_TX = "0x00000000000000000000000000000000000000000000000000000000000000c1";
const SELL_TX = "0x00000000000000000000000000000000000000000000000000000000000000d1";

/** Session 8, written after session 7 as the SessionFactory handler would: the duplicate child's tokens stay 7's. */
async function seedLaterSession(indexer: TestIndexer) {
  const session = await indexer.Session.getOrThrow(SESSION_ID);
  await indexer.Session.set({ ...session, id: LATER_SESSION, sessionId: BigInt(LATER_SESSION) });

  const child = await indexer.ChildMarket.getOrThrow(CHILD_MARKET);
  await indexer.ChildMarket.set({
    ...child,
    id: LATER_MARKET,
    session_id: LATER_SESSION,
    downToken: LATER_DOWN,
    upToken: LATER_UP,
    invalidToken: "0x0000000000000000000000000000000000000319",
  });
  await indexer.Token.set({ id: LATER_DOWN, childMarket_id: LATER_MARKET, outcomeIndex: 0, decimals: 18, symbol: "D" });
  await indexer.Token.set({ id: LATER_UP, childMarket_id: LATER_MARKET, outcomeIndex: 1, decimals: 18, symbol: "U" });

  const other = await indexer.ChildMarket.getOrThrow(OTHER_MARKET);
  await indexer.ChildMarket.set({ ...other, id: DUPLICATE_MARKET, session_id: LATER_SESSION });
}

async function indexed(events: Parameters<typeof indexEvents>[1]) {
  const indexer = createTestIndexer();
  await seedSession(indexer, [OPTION_A, OPTION_B]);
  await seedLaterSession(indexer);
  await indexEvents(indexer, [executorDeployed(OWNER, EXECUTOR), ...events]);
  return indexer;
}

/** A prediction that split `split` parent tokens of option 0 and swapped `spent` of them for `up`. */
const predictLogs = (hash: string, up: Address, split: bigint, spent: bigint, block: number) =>
  [
    transfer(UNDERLYING, GNOSIS_ROUTER, EXECUTOR, split, block),
    transfer(UNDERLYING, EXECUTOR, POOL, spent, block),
    transfer(up, POOL, EXECUTOR, spent * 2n, block),
  ].map((log) => inTx(hash, log));

const payouts = async (indexer: TestIndexer) =>
  (await indexer.Redeem.getAll())
    .map((row) => [row.session_id, row.childMarket_id ?? null, row.parentOutcomeIndex, row.payout] as const)
    .sort(([a], [b]) => a.localeCompare(b));

describe("a redeem of a parent token two sessions share", () => {
  it("files it under the one session the trade wallet predicted in", async (t) => {
    const indexer = await indexed([
      ...predictLogs(TRADE_TX, LATER_UP, 300n, 100n, BLOCK + 2),
      ...parentRedeemLogs(EXECUTOR, [{ token: UNDERLYING, amount: 200n }], 200n).map((log) => inTx(REDEEM_TX, log)),
    ]);

    t.expect(await payouts(indexer)).toEqual([[LATER_SESSION, null, 0n, 200n]]);
  });

  it("splits it pro rata by the trade wallet's net holdings in each session", async (t) => {
    const indexer = await indexed([
      ...predictLogs(TRADE_TX, UP, 400n, 100n, BLOCK + 2),
      ...predictLogs(LATER_TRADE_TX, LATER_UP, 150n, 50n, BLOCK + 3),
      ...parentRedeemLogs(EXECUTOR, [{ token: UNDERLYING, amount: 400n }], 200n).map((log) => inTx(REDEEM_TX, log)),
    ]);

    t.expect(await payouts(indexer)).toEqual([
      [SESSION_ID, null, 0n, 150n],
      [LATER_SESSION, null, 0n, 50n],
    ]);
  });

  it("prices each token at the winners' fraction, then splits it by the sessions' holdings", async (t) => {
    const predict = (hash: string, deposit: bigint, spent: bigint, up: Address, block: number) =>
      [
        transfer(UNDERLYING, GNOSIS_ROUTER, EXECUTOR, deposit, block),
        transfer(OTHER_UNDERLYING, GNOSIS_ROUTER, EXECUTOR, deposit, block),
        transfer(UNDERLYING, EXECUTOR, POOL, spent, block),
        transfer(up, POOL, EXECUTOR, spent * 2n, block),
      ].map((log) => inTx(hash, log));
    const indexer = await indexed([
      ...predict(TRADE_TX, 400n, 100n, UP, BLOCK + 2),
      ...predict(LATER_TRADE_TX, 150n, 50n, LATER_UP, BLOCK + 3),
      ...parentRedeemLogs(
        EXECUTOR,
        [
          { token: UNDERLYING, amount: 400n },
          { token: OTHER_UNDERLYING, amount: 550n },
        ],
        475n,
      ).map((log) => inTx(REDEEM_TX, log)),
    ]);

    // two winners at 1/2: 400 and 550 pay 200 and 275, split 300/100 and 400/150
    t.expect((await payouts(indexer)).sort(([a, , i], [b, , j]) => a.localeCompare(b) || Number(i - j))).toEqual([
      [SESSION_ID, null, 0n, 150n],
      [SESSION_ID, null, 1n, 200n],
      [LATER_SESSION, null, 0n, 50n],
      [LATER_SESSION, null, 1n, 75n],
    ]);
  });

  it("weighs the sessions by what is left after a merge, in log order within a block", async (t) => {
    const merge = parentRedeemLogs(
      EXECUTOR,
      [
        { token: UNDERLYING, amount: 300n },
        { token: OTHER_UNDERLYING, amount: 300n },
        { token: PARENT_INVALID, amount: 300n },
      ],
      300n,
      BLOCK + 3,
    );
    const indexer = await indexed([
      ...predictLogs(TRADE_TX, UP, 400n, 100n, BLOCK + 2),
      ...merge.map((log) => inTx(MERGE_TX, log)),
      ...predictLogs(LATER_TRADE_TX, LATER_UP, 150n, 50n, BLOCK + 3),
      ...parentRedeemLogs(EXECUTOR, [{ token: UNDERLYING, amount: 100n }], 100n).map((log) => inTx(REDEEM_TX, log)),
    ]);

    t.expect(await payouts(indexer)).toEqual([[LATER_SESSION, null, 0n, 100n]]);
  });

  it("files it under the session the trade wallet predicted in when no session holds it on net", async (t) => {
    const indexer = await indexed([
      transfer(UNDERLYING, OWNER, EXECUTOR, 200n, BLOCK + 1),
      ...[
        transfer(UNDERLYING, EXECUTOR, POOL, 100n, BLOCK + 2),
        transfer(LATER_UP, POOL, EXECUTOR, 150n, BLOCK + 2),
      ].map((log) => inTx(TRADE_TX, log)),
      ...parentRedeemLogs(EXECUTOR, [{ token: UNDERLYING, amount: 100n }], 100n).map((log) => inTx(REDEEM_TX, log)),
    ]);

    t.expect(await payouts(indexer)).toEqual([[LATER_SESSION, null, 0n, 100n]]);
  });

  it("files a connected wallet's redeem, which no prediction places, under the earlier session", async (t) => {
    const indexer = await indexed(
      parentRedeemLogs(OWNER, [{ token: UNDERLYING, amount: 50n }], 50n).map((log) => inTx(REDEEM_TX, log)),
    );

    t.expect(await payouts(indexer)).toEqual([[SESSION_ID, null, 0n, 50n]]);
  });
});

describe("a redeem of child tokens two sessions share", () => {
  it("files it under the child the trade wallet's predictions name and leaves no Prediction", async (t) => {
    const indexer = await indexed([
      ...[
        transfer(OTHER_UNDERLYING, GNOSIS_ROUTER, EXECUTOR, 100n, BLOCK + 2),
        transfer(OTHER_UNDERLYING, EXECUTOR, POOL, 40n, BLOCK + 2),
        transfer(OTHER_UP, POOL, EXECUTOR, 80n, BLOCK + 2),
      ].map((log) => inTx(TRADE_TX, log)),
      ...childRedeemLogs(EXECUTOR, OPTION_B, { up: 80n }, 60n).map((log) => inTx(REDEEM_TX, log)),
    ]);

    t.expect(await payouts(indexer)).toEqual([[SESSION_ID, OTHER_MARKET, 1n, 60n]]);
    t.expect((await indexer.Prediction.getAll()).map((row) => row.transactionHash)).toEqual([TRADE_TX]);
  });

  it("files it under the duplicate child and drops the Prediction filed under the tokens' own child", async (t) => {
    const indexer = await indexed([
      ...[transfer(OTHER_UP, POOL, EXECUTOR, 1000n, BLOCK + 2), transfer(LATER_UP, POOL, EXECUTOR, 10n, BLOCK + 2)].map(
        (log) => inTx(TRADE_TX, log),
      ),
      inTx(SELL_TX, transfer(OTHER_UP, EXECUTOR, POOL, 600n, BLOCK + 3)),
      ...childRedeemLogs(EXECUTOR, OPTION_B, { up: 400n }, 300n).map((log) => inTx(REDEEM_TX, log)),
    ]);

    t.expect(await payouts(indexer)).toEqual([[LATER_SESSION, DUPLICATE_MARKET, 1n, 300n]]);
    t.expect((await indexer.Prediction.getAll()).map((row) => row.transactionHash).sort()).toEqual([
      TRADE_TX,
      TRADE_TX,
      SELL_TX,
    ]);
  });
});
