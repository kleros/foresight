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
  SDAI,
  transfer,
  UNDERLYING,
  UP,
} from "../support/harness";
import {
  childRedeemLogs,
  CONDITIONAL_ROUTER,
  GNOSIS_ROUTER,
  inTx,
  PARENT_INVALID,
  parentRedeemLogs,
  type RedeemOption,
  seedSession,
} from "../support/redeem";

/** Router flows that leave the same pulls as a redeem but are not one. */

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

const MINT_TX = "0x00000000000000000000000000000000000000000000000000000000000000c1";
const REDEEM_TX = "0x00000000000000000000000000000000000000000000000000000000000000a1";

async function indexed(events: Parameters<typeof indexEvents>[1]) {
  const indexer = createTestIndexer();
  await seedSession(indexer, [OPTION_A, OPTION_B]);
  await indexEvents(indexer, [executorDeployed(OWNER, EXECUTOR), ...events]);
  return indexer;
}

/** Sets minted from option A's parent tokens through Seer's router: the tokens come back as the child's. */
const mintLogs = (amount: bigint) =>
  [
    transfer(UNDERLYING, EXECUTOR, GNOSIS_ROUTER, amount),
    transfer(DOWN, GNOSIS_ROUTER, EXECUTOR, amount),
    transfer(UP, GNOSIS_ROUTER, EXECUTOR, amount),
    transfer(OPTION_A.invalid, GNOSIS_ROUTER, EXECUTOR, amount),
  ].map((log) => inTx(MINT_TX, log));

describe("router flows that are not a redeem", () => {
  it("records no redeem for sets minted from parent tokens", async (t) => {
    const indexer = await indexed(mintLogs(100n));

    t.expect(await indexer.Redeem.getAll()).toEqual([]);
  });

  it("records no redeem for a parent merge, which sends INVALID beside the options", async (t) => {
    const indexer = await indexed(
      parentRedeemLogs(
        EXECUTOR,
        [
          { token: UNDERLYING, amount: 30n },
          { token: OTHER_UNDERLYING, amount: 30n },
          { token: PARENT_INVALID, amount: 30n },
        ],
        30n,
      ).map((log) => inTx(REDEEM_TX, log)),
    );

    t.expect(await indexer.Redeem.getAll()).toEqual([]);
  });

  it("splits a later redeem's payout by that transaction's pulls alone", async (t) => {
    const indexer = await indexed([
      ...mintLogs(1_000n),
      ...parentRedeemLogs(
        EXECUTOR,
        [
          { token: UNDERLYING, amount: 50n },
          { token: OTHER_UNDERLYING, amount: 30n },
        ],
        40n,
      ).map((log) => inTx(REDEEM_TX, log)),
    ]);

    const rows = await indexer.Redeem.getAll();
    t.expect(rows.map((row) => [row.parentOutcomeIndex, row.payout]).sort()).toEqual([
      [0n, 25n],
      [1n, 15n],
    ]);
  });

  it("gives the last outcome the remainder of an uneven split, so the rows sum to the payout", async (t) => {
    const indexer = await indexed(
      parentRedeemLogs(
        EXECUTOR,
        [
          { token: UNDERLYING, amount: 51n },
          { token: OTHER_UNDERLYING, amount: 31n },
        ],
        40n,
      ).map((log) => inTx(REDEEM_TX, log)),
    );

    const rows = await indexer.Redeem.getAll();
    const share = (pulled: bigint) => (40n * pulled) / 82n;
    t.expect(rows.reduce((sum, row) => sum + row.payout, 0n)).toBe(40n);
    for (const row of rows) {
      const floor = share(row.parentOutcomeIndex === 0n ? 51n : 31n);
      t.expect([floor, floor + 1n]).toContain(row.payout);
    }
  });

  it("ignores a router paying out a token other than the session's collateral", async (t) => {
    const indexer = await indexed(
      [transfer(UNDERLYING, OWNER, GNOSIS_ROUTER, 10n), transfer(UP, GNOSIS_ROUTER, OWNER, 10n)].map((log) =>
        inTx(REDEEM_TX, log),
      ),
    );

    t.expect(await indexer.Redeem.getAll()).toEqual([]);
  });
});

describe("payouts that share a transaction", () => {
  const rows = async (indexer: Awaited<ReturnType<typeof indexed>>) =>
    (await indexer.Redeem.getAll())
      .map((row) => [row.account, row.childMarket_id ?? null, row.parentOutcomeIndex, row.payout] as const)
      .sort(([a, , i], [b, , j]) => a.localeCompare(b) || Number(i - j));

  it("pays each account only for the tokens it sent the router", async (t) => {
    const indexer = await indexed(
      [
        transfer(UNDERLYING, EXECUTOR, GNOSIS_ROUTER, 50n),
        transfer(OTHER_UNDERLYING, OWNER, GNOSIS_ROUTER, 30n),
        transfer(SDAI, GNOSIS_ROUTER, EXECUTOR, 50n),
        transfer(SDAI, GNOSIS_ROUTER, OWNER, 30n),
      ].map((log) => inTx(REDEEM_TX, log)),
    );

    t.expect(await rows(indexer)).toEqual([
      [EXECUTOR, null, 0n, 50n],
      [OWNER, null, 1n, 30n],
    ]);
  });

  it("pays each router's payout against only the tokens sent to that router", async (t) => {
    const indexer = await indexed(
      [
        transfer(UP, EXECUTOR, CONDITIONAL_ROUTER, 30n),
        transfer(OTHER_UNDERLYING, EXECUTOR, GNOSIS_ROUTER, 40n),
        transfer(SDAI, GNOSIS_ROUTER, EXECUTOR, 40n),
        transfer(SDAI, CONDITIONAL_ROUTER, EXECUTOR, 27n),
      ].map((log) => inTx(REDEEM_TX, log)),
    );

    t.expect(await rows(indexer)).toEqual([
      [EXECUTOR, CHILD_MARKET, 0n, 27n],
      [EXECUTOR, null, 1n, 40n],
    ]);
  });
});

describe("a child resolved INVALID", () => {
  it("records a redeem of the child's INVALID token alone under its option", async (t) => {
    const indexer = await indexed(
      childRedeemLogs(EXECUTOR, OPTION_A, { invalid: 20n }, 20n).map((log) => inTx(REDEEM_TX, log)),
    );

    const rows = await indexer.Redeem.getAll();
    t.expect(rows.map((row) => [row.childMarket_id, row.parentOutcomeIndex, row.payout])).toEqual([
      [CHILD_MARKET, 0n, 20n],
    ]);
  });
});

describe("the redeem's own transfers", () => {
  it("keeps the trade wallet's Transfer rows and balances for a redeem", async (t) => {
    const indexer = await indexed(
      childRedeemLogs(EXECUTOR, OPTION_A, { up: 30n }, 27n).map((log) => inTx(REDEEM_TX, log)),
    );

    t.expect((await indexer.Position.getOrThrow(`${EXECUTOR}-${SDAI}`)).balance).toBe(27n);
    t.expect((await indexer.Position.getOrThrow(`${EXECUTOR}-${UP}`)).balance).toBe(-30n);
    t.expect(await indexer.Transfer.getAll()).toHaveLength(2);
  });
});
