import { createTestIndexer, type TestIndexerProcessConfig } from "envio";
import { type Address } from "viem";
import { describe, it } from "vitest";

import { CONDITIONAL_ROUTER, GNOSIS_ROUTER, ROUTER_TRANSFERS } from "../../src/utils/routers";
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
  poolCreated,
  SDAI,
  transfer,
  UNDERLYING,
  UP,
} from "../support/harness";
import {
  childSplitLogs,
  hashOf,
  ledgerOf,
  mergeLogs,
  PARENT_CONDITION,
  PARENT_MARKET,
  PARENT_MARKET_8,
  POOL_ADDRESS,
  resolved,
  SESSION_8,
  SESSION_ID,
  seedConditions,
  seedSharingSession,
  splitLogs,
  tx,
} from "../support/ledger";
import { childRedeemLogs, PARENT_INVALID, parentRedeemLogs, type RedeemOption, seedSession } from "../support/redeem";

/**
 * The trade wallet ledger (`SessionMove`) and how a redeem's payout is split between outcomes and sessions. Sessions 7
 * and 8 ask the same parent question here, so they hold the same parent tokens.
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
/** Session 8's own child on option 0. */
const OPTION_8A: RedeemOption = {
  market: "0x0000000000000000000000000000000000000c80",
  parentOutcomeIndex: 0,
  parentToken: UNDERLYING,
  down: "0x0000000000000000000000000000000000000818",
  up: "0x0000000000000000000000000000000000000817",
  invalid: "0x0000000000000000000000000000000000000819",
};
/** Session 8's own child on option 1. */
const OPTION_8B: RedeemOption = {
  market: "0x0000000000000000000000000000000000000c81",
  parentOutcomeIndex: 1,
  parentToken: OTHER_UNDERLYING,
  down: "0x0000000000000000000000000000000000000828",
  up: "0x0000000000000000000000000000000000000827",
  invalid: "0x0000000000000000000000000000000000000829",
};
/** Session 8's child on option 0 asking session 7's child question, so it has session 7's child tokens. */
const OPTION_8A_SHARED: RedeemOption = { ...OPTION_A, market: "0x0000000000000000000000000000000000000c82" };

const PARENT_TOKENS = [UNDERLYING, OTHER_UNDERLYING, PARENT_INVALID] as const;
/** A token that is neither the session's collateral nor a session token, standing in for WXDAI. */
const NOT_COLLATERAL = "0x0000000000000000000000000000000000000e9d";
const CHILD_CONDITION = `0x${"c1".repeat(32)}`;

type Indexer = ReturnType<typeof createTestIndexer>;
type Simulated = NonNullable<NonNullable<TestIndexerProcessConfig["chains"][31337]>["simulate"]>;

const run = (indexer: Indexer, simulate: Simulated) => indexer.process({ chains: { 31337: { simulate } } });

async function twoSessions(options8: readonly RedeemOption[]) {
  const indexer = createTestIndexer();
  await seedSession(indexer, [OPTION_A, OPTION_B]);
  await seedSharingSession(indexer, options8, { parentTokens: [UNDERLYING, OTHER_UNDERLYING] });
  return indexer;
}

/** A prediction in one option: a split, then sets minted at that option's child. */
const predictLogs = (holder: Address, split: bigint, option: RedeemOption, sets: bigint, block = BLOCK + 2) => [
  ...splitLogs(holder, PARENT_TOKENS, split, block),
  ...childSplitLogs(holder, option, sets, block),
];

const redeemRows = async (indexer: Indexer) =>
  (await indexer.Redeem.getAll())
    .map((row) => [row.session_id, row.childMarket_id ?? null, row.parentOutcomeIndex, row.payout] as const)
    .sort((a, b) => (a[0] + a[1] + a[2]).localeCompare(b[0] + b[1] + b[2]));

describe("the router filter", () => {
  it("follows transfers into and out of both of Seer's routers", (t) => {
    t.expect(ROUTER_TRANSFERS.params).toEqual([
      { from: [GNOSIS_ROUTER, CONDITIONAL_ROUTER] },
      { to: [GNOSIS_ROUTER, CONDITIONAL_ROUTER] },
    ]);
  });
});

describe("a trade wallet's ledger", () => {
  it("charges a prediction's split whether sDAI or credits paid it, and not a liquidity seed's split", async (t) => {
    const indexer = createTestIndexer();
    await seedSession(indexer, [OPTION_A, OPTION_B]);
    // the router splits xDAI the wallet sent as value, so no sDAI leaves the wallet
    const xdaiSplit = (amount: bigint, block: number) =>
      PARENT_TOKENS.map((token) => transfer(token, GNOSIS_ROUTER, EXECUTOR, amount, block));
    const pools = [POOL_ADDRESS, "0x0000000000000000000000000000000000000901"] as const;
    // the mint callback pays the pool, then the pool emits Mint
    const seedPool = (token: Address, pool: Address, amount: bigint, block: number) => [
      transfer(token, EXECUTOR, pool, amount, block),
      {
        contract: "AlgebraPool" as const,
        event: "Mint" as const,
        srcAddress: pool,
        block: { number: block, timestamp: block },
        params: {
          sender: OWNER,
          owner: OWNER,
          bottomTick: 0n,
          topTick: 60n,
          liquidityAmount: 1n,
          amount0: amount,
          amount1: 0n,
        },
      },
    ];
    await run(indexer, [
      executorDeployed(OWNER, EXECUTOR),
      poolCreated(UNDERLYING, UP, pools[0]),
      poolCreated(OTHER_UNDERLYING, OTHER_UP, pools[1]),
      ...tx(hashOf(1), predictLogs(EXECUTOR, 300n, OPTION_A, 100n)),
      // credits: an xDAI split, then sets minted at option 1's child in the same batch
      ...tx(hashOf(2), [...xdaiSplit(50n, BLOCK + 3), ...childSplitLogs(EXECUTOR, OPTION_B, 20n, BLOCK + 3)]),
      // a liquidity seed: its parent split, then each option's tokens into a pool, each its own transaction
      ...tx(hashOf(3), xdaiSplit(70n, BLOCK + 4)),
      ...tx(hashOf(4), seedPool(UNDERLYING, pools[0], 70n, BLOCK + 5)),
      ...tx(hashOf(5), seedPool(OTHER_UNDERLYING, pools[1], 70n, BLOCK + 6)),
    ]);

    const { balances, costs } = ledgerOf(await indexer.SessionMove.getAll());
    t.expect(costs).toEqual({ [SESSION_ID]: 350n });
    t.expect(balances[SESSION_ID]).toEqual({
      [UNDERLYING]: 250n,
      [OTHER_UNDERLYING]: 330n,
      [PARENT_INVALID]: 420n,
      [DOWN]: 100n,
      [UP]: 100n,
      [OPTION_A.invalid]: 100n,
      [OTHER_DOWN]: 20n,
      [OTHER_UP]: 20n,
      [OPTION_B.invalid]: 20n,
    });
  });

  it("takes a merge's sDAI off the cost and records no redeem", async (t) => {
    const indexer = createTestIndexer();
    await seedSession(indexer, [OPTION_A, OPTION_B]);
    await run(indexer, [
      executorDeployed(OWNER, EXECUTOR),
      ...tx(hashOf(1), splitLogs(EXECUTOR, PARENT_TOKENS, 300n)),
      ...tx(hashOf(2), mergeLogs(EXECUTOR, PARENT_TOKENS, 100n)),
    ]);

    const { balances, costs } = ledgerOf(await indexer.SessionMove.getAll());
    t.expect(costs).toEqual({ [SESSION_ID]: 200n });
    t.expect(Object.values(balances[SESSION_ID]!)).toEqual([200n, 200n, 200n]);
    t.expect(await indexer.Redeem.getAll()).toEqual([]);
  });

  it("reads a whole set's sDAI as a merge whether or not the parent resolved", async (t) => {
    const unresolved = createTestIndexer();
    const resolvedFirst = createTestIndexer();
    for (const indexer of [unresolved, resolvedFirst]) {
      await seedSession(indexer, [OPTION_A, OPTION_B]);
      await seedConditions(indexer, { [PARENT_MARKET]: PARENT_CONDITION });
    }
    const split = [executorDeployed(OWNER, EXECUTOR), ...tx(hashOf(1), splitLogs(EXECUTOR, PARENT_TOKENS, 300n))];
    const merge = tx(hashOf(2), mergeLogs(EXECUTOR, PARENT_TOKENS, 100n, BLOCK + 10));
    await run(unresolved, [...split, ...merge]);
    await run(resolvedFirst, [...split, resolved(PARENT_CONDITION, [1n, 0n, 0n]), ...merge]);

    for (const indexer of [unresolved, resolvedFirst]) {
      t.expect(ledgerOf(await indexer.SessionMove.getAll()).costs).toEqual({ [SESSION_ID]: 200n });
      t.expect(await indexer.Redeem.getAll()).toEqual([]);
    }
  });
});

describe("a redeem before its resolution is indexed", () => {
  it("records a parent redeem whose condition the indexer has not seen resolve", async (t) => {
    const indexer = createTestIndexer();
    await seedSession(indexer, [OPTION_A, OPTION_B]);
    await seedConditions(indexer, { [PARENT_MARKET]: PARENT_CONDITION });
    await run(indexer, tx(hashOf(1), parentRedeemLogs(OWNER, [{ token: UNDERLYING, amount: 50n }], 50n)));

    t.expect(await redeemRows(indexer)).toEqual([[SESSION_ID, null, 0n, 50n]]);
  });
});

describe("a payout sent on to the owner", () => {
  it("leaves the ledger as a redeem that keeps the sDAI in the trade wallet", async (t) => {
    const ledgers = [];
    for (const sentOn of [false, true]) {
      const indexer = createTestIndexer();
      await seedSession(indexer, [OPTION_A, OPTION_B]);
      await run(indexer, [
        executorDeployed(OWNER, EXECUTOR),
        ...tx(hashOf(1), predictLogs(EXECUTOR, 300n, OPTION_A, 100n)),
        ...tx(hashOf(2), [
          ...parentRedeemLogs(EXECUTOR, [{ token: UNDERLYING, amount: 200n }], 200n),
          ...(sentOn ? [transfer(SDAI, EXECUTOR, OWNER, 200n, BLOCK + 10)] : []),
        ]),
      ]);
      ledgers.push(ledgerOf(await indexer.SessionMove.getAll()));
    }

    t.expect(ledgers[1]).toEqual(ledgers[0]);
    t.expect(ledgers[0]!.costs).toEqual({ [SESSION_ID]: 300n });
  });
});

describe("sessions sharing parent tokens", () => {
  it("credits the shared tokens to the session the transaction predicts in, and its redeem to it", async (t) => {
    const indexer = await twoSessions([OPTION_8A]);
    await run(indexer, [
      executorDeployed(OWNER, EXECUTOR),
      ...tx(hashOf(1), predictLogs(EXECUTOR, 100n, OPTION_8A, 60n)),
      ...tx(hashOf(2), parentRedeemLogs(EXECUTOR, [{ token: UNDERLYING, amount: 40n }], 40n)),
    ]);

    const { balances, costs } = ledgerOf(await indexer.SessionMove.getAll());
    t.expect(costs).toEqual({ [SESSION_8]: 100n });
    t.expect(balances[SESSION_ID]).toBeUndefined();
    t.expect(balances[SESSION_8]).toMatchObject({ [UNDERLYING]: 0n, [OTHER_UNDERLYING]: 100n, [OPTION_8A.up]: 60n });
    t.expect(await redeemRows(indexer)).toEqual([[SESSION_8, null, 0n, 40n]]);
  });

  it("splits a redeem of a shared token pro rata by what each session holds of it", async (t) => {
    const indexer = await twoSessions([OPTION_8A]);
    await run(indexer, [
      executorDeployed(OWNER, EXECUTOR),
      ...tx(hashOf(1), predictLogs(EXECUTOR, 300n, OPTION_A, 100n)),
      ...tx(hashOf(2), predictLogs(EXECUTOR, 100n, OPTION_8A, 40n)),
      ...tx(hashOf(3), parentRedeemLogs(EXECUTOR, [{ token: OTHER_UNDERLYING, amount: 400n }], 400n)),
    ]);

    t.expect(ledgerOf(await indexer.SessionMove.getAll()).costs).toEqual({ [SESSION_ID]: 300n, [SESSION_8]: 100n });
    t.expect(await redeemRows(indexer)).toEqual([
      [SESSION_ID, null, 1n, 300n],
      [SESSION_8, null, 1n, 100n],
    ]);
  });

  it("splits a shared redeem by holdings even when the batch also redeems one session's own child", async (t) => {
    const indexer = await twoSessions([OPTION_8A]);
    await run(indexer, [
      executorDeployed(OWNER, EXECUTOR),
      ...tx(hashOf(1), predictLogs(EXECUTOR, 300n, OPTION_A, 100n)),
      ...tx(hashOf(2), predictLogs(EXECUTOR, 100n, OPTION_8A, 40n)),
      ...tx(hashOf(3), [
        ...childRedeemLogs(EXECUTOR, OPTION_8A, { up: 40n }, 40n),
        ...parentRedeemLogs(EXECUTOR, [{ token: OTHER_UNDERLYING, amount: 400n }], 400n),
      ]),
    ]);

    t.expect(await redeemRows(indexer)).toEqual([
      [SESSION_ID, null, 1n, 300n],
      [SESSION_8, OPTION_8A.market, 0n, 40n],
      [SESSION_8, null, 1n, 100n],
    ]);
  });

  it("weighs a later redeem without the sets a session merged away", async (t) => {
    const indexer = await twoSessions([OPTION_8A, OPTION_8B]);
    await run(indexer, [
      executorDeployed(OWNER, EXECUTOR),
      // session 7 keeps 300 whole parent sets, then merges them
      ...tx(hashOf(1), predictLogs(EXECUTOR, 400n, OPTION_A, 100n)),
      ...tx(hashOf(2), mergeLogs(EXECUTOR, PARENT_TOKENS, 300n)),
      // session 8 then predicts on its option 1, keeping 100 of option 0's parent token
      ...tx(hashOf(3), predictLogs(EXECUTOR, 100n, OPTION_8B, 50n, BLOCK + 4)),
      ...tx(hashOf(4), parentRedeemLogs(EXECUTOR, [{ token: UNDERLYING, amount: 100n }], 100n)),
    ]);

    t.expect(ledgerOf(await indexer.SessionMove.getAll()).costs).toEqual({ [SESSION_ID]: 100n, [SESSION_8]: 100n });
    t.expect(await redeemRows(indexer)).toEqual([[SESSION_8, null, 0n, 100n]]);
  });
  it("files a connected wallet's redeem of a shared token under the earliest session", async (t) => {
    const indexer = await twoSessions([OPTION_8A]);
    await run(indexer, tx(hashOf(1), parentRedeemLogs(OWNER, [{ token: UNDERLYING, amount: 50n }], 50n)));

    t.expect(await redeemRows(indexer)).toEqual([[SESSION_ID, null, 0n, 50n]]);
  });
});

describe("sessions sharing a child", () => {
  it.for([
    ["the parent token leaves before the child token arrives", [0, 1]],
    ["the child token arrives before the parent token leaves", [1, 0]],
  ] as const)("credits a child trade to the session its prediction is filed under when %s", async ([, order], t) => {
    const indexer = await twoSessions([OPTION_8A_SHARED]);
    await seedConditions(indexer, {
      [PARENT_MARKET]: PARENT_CONDITION,
      [PARENT_MARKET_8]: PARENT_CONDITION,
      [CHILD_MARKET]: CHILD_CONDITION,
      [OPTION_8A_SHARED.market]: CHILD_CONDITION,
    });
    await run(indexer, [
      executorDeployed(OWNER, EXECUTOR),
      ...tx(
        hashOf(1),
        order.map(
          (leg) =>
            [
              transfer(UNDERLYING, EXECUTOR, POOL_ADDRESS, 40n, BLOCK + 2),
              transfer(UP, POOL_ADDRESS, EXECUTOR, 80n, BLOCK + 2),
            ][leg]!,
        ),
      ),
      resolved(PARENT_CONDITION, [1n, 0n, 0n]),
      resolved(CHILD_CONDITION, [1n, 3n, 0n], BLOCK + 6),
      ...tx(hashOf(2), childRedeemLogs(EXECUTOR, OPTION_A, { up: 80n }, 60n)),
    ]);

    const { balances } = ledgerOf(await indexer.SessionMove.getAll());
    t.expect(balances[SESSION_8]).toBeUndefined();
    t.expect(balances[SESSION_ID]).toEqual({ [UNDERLYING]: -40n, [UP]: 0n });
    t.expect(await redeemRows(indexer)).toEqual([[SESSION_ID, CHILD_MARKET, 0n, 60n]]);
  });

  it("splits one child payout by what each session's tokens pay, not by their count", async (t) => {
    const indexer = await twoSessions([OPTION_8A_SHARED]);
    await seedConditions(indexer, {
      [PARENT_MARKET]: PARENT_CONDITION,
      [PARENT_MARKET_8]: PARENT_CONDITION,
      [CHILD_MARKET]: CHILD_CONDITION,
      [OPTION_8A_SHARED.market]: CHILD_CONDITION,
    });
    // what the ledger already credits: session 7 holds 100 DOWN, session 8 holds 50 UP
    for (const [session, token, amount] of [
      [SESSION_ID, DOWN, 100n],
      [SESSION_8, UP, 50n],
    ] as const) {
      await indexer.SessionMove.set({
        id: `${hashOf(1)}-0-${EXECUTOR}-${session}`,
        account: EXECUTOR,
        session_id: session,
        token,
        amount,
        cost: 0n,
        shared: true,
        redeemed: false,
        logIndex: token === DOWN ? 0 : 1,
        blockNumber: BigInt(BLOCK),
        transactionHash: hashOf(1),
      });
    }
    await run(indexer, [
      executorDeployed(OWNER, EXECUTOR),
      resolved(PARENT_CONDITION, [1n, 0n, 0n]),
      // DOWN pays 0.2 and UP 0.8
      resolved(CHILD_CONDITION, [2n, 8n, 0n], BLOCK + 6),
      ...tx(hashOf(2), childRedeemLogs(EXECUTOR, OPTION_A, { up: 50n, down: 100n }, 60n)),
    ]);

    t.expect(await redeemRows(indexer)).toEqual([
      [SESSION_ID, CHILD_MARKET, 0n, 20n],
      [SESSION_8, OPTION_8A_SHARED.market, 0n, 40n],
    ]);
  });
});

describe("splitting a payout", () => {
  it("pays each outcome of a parent redeem its own floored payout", async (t) => {
    const indexer = createTestIndexer();
    await seedSession(indexer, [OPTION_A, OPTION_B]);
    await seedConditions(indexer, { [PARENT_MARKET]: PARENT_CONDITION });
    await run(indexer, [
      resolved(PARENT_CONDITION, [1n, 3n, 0n]),
      ...tx(
        hashOf(1),
        parentRedeemLogs(
          OWNER,
          [
            { token: UNDERLYING, amount: 4n },
            { token: OTHER_UNDERLYING, amount: 4n },
          ],
          4n,
        ),
      ),
    ]);

    t.expect(await redeemRows(indexer)).toEqual([
      [SESSION_ID, null, 0n, 1n],
      [SESSION_ID, null, 1n, 3n],
    ]);
  });

  it("records a parent redeem of a session whose children are not deployed yet", async (t) => {
    const indexer = createTestIndexer();
    const tokens = ["0x0000000000000000000000000000000000009a00", "0x0000000000000000000000000000000000009a01"];
    await seedSharingSession(indexer, [], {
      id: "9",
      parentMarket: "0x0000000000000000000000000000000000000b09",
      parentTokens: tokens,
    });
    await run(indexer, tx(hashOf(1), parentRedeemLogs(OWNER, [{ token: tokens[1] as Address, amount: 30n }], 30n)));

    t.expect(await redeemRows(indexer)).toEqual([["9", null, 1n, 30n]]);
  });

  it("records a redeem that pays nothing, and no prediction for it", async (t) => {
    for (const holder of [EXECUTOR, OWNER] as const) {
      const indexer = createTestIndexer();
      await seedSession(indexer, [OPTION_A, OPTION_B]);
      await run(indexer, [
        executorDeployed(OTHER_OWNER, EXECUTOR),
        ...tx(hashOf(1), childRedeemLogs(holder, OPTION_A, { down: 10n }, 0n)),
      ]);

      t.expect(await redeemRows(indexer)).toEqual([[SESSION_ID, CHILD_MARKET, 0n, 0n]]);
      t.expect(await indexer.Prediction.getAll()).toEqual([]);
    }
  });

  it("pays a redeem only the tokens pulled since the router last answered with tokens", async (t) => {
    const indexer = createTestIndexer();
    await seedSession(indexer, [OPTION_A, OPTION_B]);
    await run(indexer, [
      executorDeployed(OTHER_OWNER, EXECUTOR),
      ...tx(hashOf(1), [
        // sets minted at option 0's child, then option 1's parent tokens redeemed, through the same router
        ...childSplitLogs(EXECUTOR, OPTION_A, 20n, BLOCK + 10),
        ...parentRedeemLogs(EXECUTOR, [{ token: OTHER_UNDERLYING, amount: 30n }], 30n),
      ]),
    ]);

    t.expect(await redeemRows(indexer)).toEqual([[SESSION_ID, null, 1n, 30n]]);
    t.expect(await indexer.RedeemPull.getAll()).toEqual([]);
  });

  it("keeps no pull for a router's own wrapping, which mints from and burns to the zero address", async (t) => {
    const zero = "0x0000000000000000000000000000000000000000";
    const indexer = createTestIndexer();
    await seedSession(indexer, [OPTION_A, OPTION_B]);
    await run(
      indexer,
      tx(hashOf(1), [
        transfer(SDAI, OWNER, GNOSIS_ROUTER, 10n, BLOCK + 10),
        ...PARENT_TOKENS.flatMap((token) => [
          transfer(token, zero, GNOSIS_ROUTER, 10n, BLOCK + 10),
          transfer(token, GNOSIS_ROUTER, OWNER, 10n, BLOCK + 10),
        ]),
      ]),
    );

    t.expect(await indexer.RedeemPull.getAll()).toEqual([]);
  });

  it.for([
    ["a trade wallet", EXECUTOR],
    ["a connected wallet", OWNER],
  ] as const)("pays %s's redeem only from the session's collateral", async ([, holder], t) => {
    const indexer = createTestIndexer();
    await seedSession(indexer, [OPTION_A, OPTION_B]);
    await run(indexer, [
      executorDeployed(OTHER_OWNER, EXECUTOR),
      ...tx(hashOf(1), [
        transfer(UNDERLYING, holder, GNOSIS_ROUTER, 50n, BLOCK + 10),
        transfer(NOT_COLLATERAL, GNOSIS_ROUTER, holder, 7n, BLOCK + 10),
        transfer(SDAI, GNOSIS_ROUTER, holder, 50n, BLOCK + 10),
      ]),
    ]);

    const rows = (await indexer.Redeem.getAll()).map((row) => [row.account, row.parentOutcomeIndex, row.payout]);
    t.expect(rows).toEqual([[holder, 0n, 50n]]);
  });

  it("pays an account only the tokens it sent the router", async (t) => {
    const indexer = createTestIndexer();
    await seedSession(indexer, [OPTION_A, OPTION_B]);
    await run(
      indexer,
      tx(hashOf(1), [
        transfer(UNDERLYING, OWNER, GNOSIS_ROUTER, 50n, BLOCK + 10),
        transfer(OTHER_UNDERLYING, OTHER_OWNER, GNOSIS_ROUTER, 30n, BLOCK + 10),
        transfer(SDAI, GNOSIS_ROUTER, OWNER, 50n, BLOCK + 10),
        transfer(SDAI, GNOSIS_ROUTER, OTHER_OWNER, 30n, BLOCK + 10),
      ]),
    );

    const rows = (await indexer.Redeem.getAll()).map((row) => [row.account, row.parentOutcomeIndex, row.payout]);
    t.expect(rows.sort()).toEqual([
      [OWNER, 0n, 50n],
      [OTHER_OWNER, 1n, 30n],
    ]);
  });

  it("pays from each router only the tokens sent to that router", async (t) => {
    const indexer = createTestIndexer();
    await seedSession(indexer, [OPTION_A, OPTION_B]);
    await run(
      indexer,
      tx(hashOf(1), [
        transfer(UNDERLYING, OWNER, GNOSIS_ROUTER, 50n, BLOCK + 10),
        transfer(UP, OWNER, CONDITIONAL_ROUTER, 10n, BLOCK + 10),
        transfer(SDAI, CONDITIONAL_ROUTER, OWNER, 7n, BLOCK + 10),
        transfer(SDAI, GNOSIS_ROUTER, OWNER, 50n, BLOCK + 10),
      ]),
    );

    t.expect(await redeemRows(indexer)).toEqual([
      [SESSION_ID, CHILD_MARKET, 0n, 7n],
      [SESSION_ID, null, 0n, 50n],
    ]);
  });
});
