import { createTestIndexer } from "envio";
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
  SDAI,
  transfer,
  UNDERLYING,
  UP,
} from "../support/harness";
import {
  childRedeemLogs,
  inTx,
  PARENT_INVALID,
  parentRedeemLogs,
  type RedeemOption,
  seedSession,
  SESSION_ID,
} from "../support/redeem";

/**
 * Acceptance tests for issue 2026-11-24-foresight-redeem-7-indexer-pnl, A1 to A3 and A6. Each redeem is fed as the
 * ERC-20 logs the issue names (the routers pulling the tokens, then paying sDAI); the sequences are not recorded
 * from a fork.
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
const OPTIONS = [OPTION_A, OPTION_B] as const;
/** The parent's INVALID slot follows its options. */
const INVALID_INDEX = BigInt(OPTIONS.length);

const REDEEM_TX = "0x00000000000000000000000000000000000000000000000000000000000000a1";
const TRADE_TX = "0x00000000000000000000000000000000000000000000000000000000000000b1";

type Row = Awaited<ReturnType<ReturnType<typeof createTestIndexer>["Redeem"]["getAll"]>>[number];

/** What A1 asks a redeem row to carry, in a stable order. */
const recorded = (rows: Row[]) =>
  rows
    .map((row) => ({
      account: row.account,
      session: row.session_id,
      childMarket: row.childMarket_id ?? null,
      parentOutcomeIndex: row.parentOutcomeIndex,
      payout: row.payout,
      transactionHash: row.transactionHash,
    }))
    .sort((a, b) =>
      a.parentOutcomeIndex === b.parentOutcomeIndex
        ? String(a.childMarket).localeCompare(String(b.childMarket))
        : Number(a.parentOutcomeIndex - b.parentOutcomeIndex),
    );

async function indexed(events: Parameters<typeof indexEvents>[1]) {
  const indexer = createTestIndexer();
  await seedSession(indexer, OPTIONS);
  await indexEvents(indexer, events);
  return indexer;
}

/** A batch redeeming option B's parent tokens and both options' child tokens, each part paid separately. */
const batchRedeem = (holder: typeof EXECUTOR | typeof OWNER) => [
  ...parentRedeemLogs(holder, [{ token: OTHER_UNDERLYING, amount: 40n }], 40n),
  ...childRedeemLogs(holder, OPTION_A, { up: 30n, down: 10n }, 27n),
  ...childRedeemLogs(holder, OPTION_B, { up: 5n, down: 20n, invalid: 2n }, 9n),
];

const batchRows = (account: string) => [
  {
    account,
    session: SESSION_ID,
    childMarket: CHILD_MARKET,
    parentOutcomeIndex: 0n,
    payout: 27n,
    transactionHash: REDEEM_TX,
  },
  {
    account,
    session: SESSION_ID,
    childMarket: OTHER_MARKET,
    parentOutcomeIndex: 1n,
    payout: 9n,
    transactionHash: REDEEM_TX,
  },
  { account, session: SESSION_ID, childMarket: null, parentOutcomeIndex: 1n, payout: 40n, transactionHash: REDEEM_TX },
];

describe("A1: a trade wallet redeem is recorded", () => {
  it("records a parent outcome redeem through Seer's router with its outcome and sDAI paid", async (t) => {
    const indexer = await indexed([
      executorDeployed(OWNER, EXECUTOR),
      ...parentRedeemLogs(EXECUTOR, [{ token: UNDERLYING, amount: 50n }], 50n).map((log) => inTx(REDEEM_TX, log)),
    ]);

    t.expect(recorded(await indexer.Redeem.getAll())).toEqual([
      {
        account: EXECUTOR,
        session: SESSION_ID,
        childMarket: null,
        parentOutcomeIndex: 0n,
        payout: 50n,
        transactionHash: REDEEM_TX,
      },
    ]);
  });

  it("names every outcome of one parent redeem and sums their rows to the sDAI it paid", async (t) => {
    const indexer = await indexed([
      executorDeployed(OWNER, EXECUTOR),
      ...parentRedeemLogs(
        EXECUTOR,
        [
          { token: UNDERLYING, amount: 50n },
          { token: OTHER_UNDERLYING, amount: 30n },
        ],
        40n,
      ).map((log) => inTx(REDEEM_TX, log)),
    ]);

    const rows = recorded(await indexer.Redeem.getAll());
    t.expect([...new Set(rows.map((row) => row.parentOutcomeIndex))]).toEqual([0n, 1n]);
    t.expect(rows.every((row) => row.account === EXECUTOR && row.session === SESSION_ID)).toBe(true);
    t.expect(rows.every((row) => row.childMarket === null && row.transactionHash === REDEEM_TX)).toBe(true);
    t.expect(rows.reduce((sum, row) => sum + row.payout, 0n)).toBe(40n);
  });

  it("records a redeem of the parent's INVALID token under the INVALID outcome", async (t) => {
    const indexer = await indexed([
      executorDeployed(OWNER, EXECUTOR),
      ...parentRedeemLogs(EXECUTOR, [{ token: PARENT_INVALID, amount: 60n }], 20n).map((log) => inTx(REDEEM_TX, log)),
    ]);

    t.expect(recorded(await indexer.Redeem.getAll())).toEqual([
      {
        account: EXECUTOR,
        session: SESSION_ID,
        childMarket: null,
        parentOutcomeIndex: INVALID_INDEX,
        payout: 20n,
        transactionHash: REDEEM_TX,
      },
    ]);
  });

  it("records a child redeem through the conditional router with its option and sDAI paid", async (t) => {
    const indexer = await indexed([
      executorDeployed(OWNER, EXECUTOR),
      ...childRedeemLogs(EXECUTOR, OPTION_B, { up: 30n, down: 10n }, 27n).map((log) => inTx(REDEEM_TX, log)),
    ]);

    t.expect(recorded(await indexer.Redeem.getAll())).toEqual([
      {
        account: EXECUTOR,
        session: SESSION_ID,
        childMarket: OTHER_MARKET,
        parentOutcomeIndex: 1n,
        payout: 27n,
        transactionHash: REDEEM_TX,
      },
    ]);
  });

  it("records each part of one batch with the sDAI that part paid", async (t) => {
    const indexer = await indexed([
      executorDeployed(OWNER, EXECUTOR),
      ...batchRedeem(EXECUTOR).map((log) => inTx(REDEEM_TX, log)),
    ]);

    t.expect(recorded(await indexer.Redeem.getAll())).toEqual(batchRows(EXECUTOR));
  });
});

describe("A2: a connected wallet redeem is recorded", () => {
  it("records a parent outcome redeem sent from the wallet itself", async (t) => {
    const indexer = await indexed(
      parentRedeemLogs(OWNER, [{ token: UNDERLYING, amount: 50n }], 50n).map((log) => inTx(REDEEM_TX, log)),
    );

    t.expect(recorded(await indexer.Redeem.getAll())).toEqual([
      {
        account: OWNER,
        session: SESSION_ID,
        childMarket: null,
        parentOutcomeIndex: 0n,
        payout: 50n,
        transactionHash: REDEEM_TX,
      },
    ]);
  });

  it("records a child redeem sent from the wallet itself", async (t) => {
    const indexer = await indexed(
      childRedeemLogs(OWNER, OPTION_A, { up: 12n, invalid: 3n }, 11n).map((log) => inTx(REDEEM_TX, log)),
    );

    t.expect(recorded(await indexer.Redeem.getAll())).toEqual([
      {
        account: OWNER,
        session: SESSION_ID,
        childMarket: CHILD_MARKET,
        parentOutcomeIndex: 0n,
        payout: 11n,
        transactionHash: REDEEM_TX,
      },
    ]);
  });

  it("records each part of a wallet batch with the sDAI that part paid", async (t) => {
    const indexer = await indexed(batchRedeem(OWNER).map((log) => inTx(REDEEM_TX, log)));

    t.expect(recorded(await indexer.Redeem.getAll())).toEqual(batchRows(OWNER));
  });
});

describe("A3: a redeem is not read as a trade", () => {
  it.for([
    ["a parent redeem", parentRedeemLogs(EXECUTOR, [{ token: UNDERLYING, amount: 50n }], 50n)],
    ["a child redeem", childRedeemLogs(EXECUTOR, OPTION_A, { up: 30n, down: 10n, invalid: 4n }, 27n)],
    ["a batch of both", batchRedeem(EXECUTOR)],
  ] as const)("writes no Prediction for %s", async ([, logs], t) => {
    const indexer = await indexed([executorDeployed(OWNER, EXECUTOR), ...logs.map((log) => inTx(REDEEM_TX, log))]);

    t.expect(await indexer.Prediction.getAll()).toEqual([]);
    t.expect(await indexer.Redeem.getAll()).not.toEqual([]);
  });

  it("leaves the trade before it as the only prediction, unchanged", async (t) => {
    const trade = [
      transfer(UNDERLYING, EXECUTOR, POOL, 20n, BLOCK + 2),
      transfer(UP, POOL, EXECUTOR, 30n, BLOCK + 2),
    ].map((log) => inTx(TRADE_TX, log));
    const before = await indexed([executorDeployed(OWNER, EXECUTOR), ...trade]);
    const after = await indexed([
      executorDeployed(OWNER, EXECUTOR),
      ...trade,
      ...childRedeemLogs(EXECUTOR, OPTION_A, { up: 30n }, 30n).map((log) => inTx(REDEEM_TX, log)),
    ]);

    const tradeRows = await before.Prediction.getAll();
    t.expect(tradeRows.map((row) => row.transactionHash)).toEqual([TRADE_TX]);
    t.expect(await after.Prediction.getAll()).toEqual(tradeRows);
  });
});

describe("A6: a payout sent on to the owner in the same transaction", () => {
  it("records the same payouts as a redeem that leaves the sDAI in the trade wallet", async (t) => {
    const kept = await indexed([
      executorDeployed(OWNER, EXECUTOR),
      ...batchRedeem(EXECUTOR).map((log) => inTx(REDEEM_TX, log)),
    ]);
    const sentOn = await indexed([
      executorDeployed(OWNER, EXECUTOR),
      ...[...batchRedeem(EXECUTOR), transfer(SDAI, EXECUTOR, OWNER, 76n, BLOCK + 10)].map((log) =>
        inTx(REDEEM_TX, log),
      ),
    ]);

    t.expect(recorded(await sentOn.Redeem.getAll())).toEqual(batchRows(EXECUTOR));
    t.expect(recorded(await sentOn.Redeem.getAll())).toEqual(recorded(await kept.Redeem.getAll()));
  });

  it("records the same payout for a single redeem whose sDAI goes on to the owner", async (t) => {
    const redeem = parentRedeemLogs(EXECUTOR, [{ token: UNDERLYING, amount: 50n }], 45n);
    const kept = await indexed([executorDeployed(OWNER, EXECUTOR), ...redeem.map((log) => inTx(REDEEM_TX, log))]);
    const sentOn = await indexed([
      executorDeployed(OWNER, EXECUTOR),
      ...[...redeem, transfer(SDAI, EXECUTOR, OWNER, 45n, BLOCK + 10)].map((log) => inTx(REDEEM_TX, log)),
    ]);

    t.expect((await sentOn.Redeem.getAll()).map((row) => row.payout)).toEqual([45n]);
    t.expect(recorded(await sentOn.Redeem.getAll())).toEqual(recorded(await kept.Redeem.getAll()));
  });
});
