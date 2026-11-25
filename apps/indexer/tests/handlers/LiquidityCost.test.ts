import { createTestIndexer, type TestIndexerProcessConfig } from "envio";
import { type Address } from "viem";
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
  poolCreated,
  transfer,
  UNDERLYING,
  UP,
} from "../support/harness";
import { childSplitLogs, hashOf, ledgerOf, mergeLogs, splitLogs, tx } from "../support/ledger";
import { PARENT_INVALID, type RedeemOption, seedSession, SESSION_ID } from "../support/redeem";

/**
 * A trade wallet's liquidity, as `throughTradeWallet` sends a seed: the parent split in a batch of its own, then one
 * batch per branch that splits the child and mints its two pools. The mint callback pays each pool just before Mint.
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
const POOLS = {
  [UP]: "0x0000000000000000000000000000000000000a01",
  [DOWN]: "0x0000000000000000000000000000000000000a02",
  [OTHER_UP]: "0x0000000000000000000000000000000000000a03",
  [OTHER_DOWN]: "0x0000000000000000000000000000000000000a04",
} as const;

type Indexer = ReturnType<typeof createTestIndexer>;
type Simulated = NonNullable<NonNullable<TestIndexerProcessConfig["chains"][31337]>["simulate"]>;

const run = (indexer: Indexer, simulate: Simulated) =>
  indexer.process({
    chains: {
      31337: {
        simulate: [
          executorDeployed(OWNER, EXECUTOR),
          ...[OPTION_A, OPTION_B].flatMap((option) =>
            [option.up, option.down].map((token) =>
              poolCreated(option.parentToken, token, POOLS[token as keyof typeof POOLS]),
            ),
          ),
          ...simulate,
        ],
      },
    },
  });

const ticks = { bottomTick: -60n, topTick: 60n, liquidityAmount: 1n };
const mintEvent = (pool: Address, amount0: bigint, amount1: bigint, block: number) => ({
  contract: "AlgebraPool" as const,
  event: "Mint" as const,
  srcAddress: pool,
  block: { number: block, timestamp: block },
  params: { sender: OWNER, owner: OWNER, ...ticks, amount0, amount1 },
});
const burnEvent = (pool: Address, amount0: bigint, block: number) => ({
  contract: "AlgebraPool" as const,
  event: "Burn" as const,
  srcAddress: pool,
  block: { number: block, timestamp: block },
  params: { owner: OWNER, ...ticks, amount0, amount1: 0n },
});

/** `parent` of the option's parent token and `child` of one child token into that token's pool. */
const deposit = (option: RedeemOption, token: Address, parent: bigint, child: bigint, block: number) => {
  const pool = POOLS[token as keyof typeof POOLS];
  return [
    transfer(option.parentToken, EXECUTOR, pool, parent, block),
    transfer(token, EXECUTOR, pool, child, block),
    mintEvent(pool, parent, child, block),
  ];
};

/** A branch's seed batch: half the parent tokens split at the child, then both pools minted. */
const branchSeed = (option: RedeemOption, amount: bigint, block: number) => [
  ...childSplitLogs(EXECUTOR, option, amount / 2n, block),
  ...deposit(option, option.up, amount / 4n, amount / 2n, block),
  ...deposit(option, option.down, amount / 4n, amount / 2n, block),
];

const xdaiSplit = (amount: bigint, block: number) =>
  PARENT_TOKENS.map((token) => transfer(token, GNOSIS_ROUTER, EXECUTOR, amount, block));

const seed = (paid: "sDAI" | "xDAI", amount: bigint, first: number, block: number) => [
  ...tx(hashOf(first), paid === "sDAI" ? splitLogs(EXECUTOR, PARENT_TOKENS, amount, block) : xdaiSplit(amount, block)),
  ...tx(hashOf(first + 1), branchSeed(OPTION_A, amount, block + 1)),
  ...tx(hashOf(first + 2), branchSeed(OPTION_B, amount, block + 2)),
];

/** A Remove: the pool's Burn, then what the position collects reaching the trade wallet. */
const withdrawal = (option: RedeemOption, amount: bigint, block: number) => {
  const pool = POOLS[option.up as keyof typeof POOLS];
  return [burnEvent(pool, amount, block), transfer(option.parentToken, pool, EXECUTOR, amount, block)];
};

async function seeded() {
  const indexer = createTestIndexer();
  await seedSession(indexer, [OPTION_A, OPTION_B]);
  return indexer;
}

const costOf = async (indexer: Indexer) => ledgerOf(await indexer.SessionMove.getAll()).costs[SESSION_ID];

describe("a liquidity seed through the trade wallet", () => {
  it.for(["sDAI", "xDAI"] as const)("leaves no prediction cost when %s paid its split", async (paid, t) => {
    const indexer = await seeded();
    await run(indexer, seed(paid, 100n, 1, BLOCK + 2));

    t.expect(await costOf(indexer)).toBe(0n);
  });

  it("leaves a prediction in the same session at its own cost", async (t) => {
    const indexer = await seeded();
    await run(indexer, [
      ...tx(hashOf(1), [...splitLogs(EXECUTOR, PARENT_TOKENS, 300n), ...childSplitLogs(EXECUTOR, OPTION_A, 100n)]),
      ...seed("sDAI", 100n, 2, BLOCK + 3),
    ]);

    t.expect(await costOf(indexer)).toBe(300n);
  });
});

describe("a merge", () => {
  it("takes no cost off for sets that came back from a liquidity position", async (t) => {
    const indexer = await seeded();
    await run(indexer, [
      ...tx(hashOf(1), splitLogs(EXECUTOR, PARENT_TOKENS, 300n)),
      ...tx(hashOf(2), [...withdrawal(OPTION_A, 100n, BLOCK + 3), ...withdrawal(OPTION_B, 100n, BLOCK + 3)]),
      ...tx(hashOf(3), mergeLogs(EXECUTOR, PARENT_TOKENS, 100n, BLOCK + 4)),
    ]);

    t.expect(await costOf(indexer)).toBe(300n);
  });

  it("never takes the cost below zero", async (t) => {
    const indexer = await seeded();
    await run(indexer, [
      ...tx(hashOf(1), splitLogs(EXECUTOR, PARENT_TOKENS, 100n)),
      ...tx(hashOf(2), mergeLogs(EXECUTOR, PARENT_TOKENS, 100n, BLOCK + 3)),
      // sets the owner sends in carry no cost either
      ...tx(
        hashOf(3),
        PARENT_TOKENS.map((token) => transfer(token, OWNER, EXECUTOR, 50n, BLOCK + 4)),
      ),
      ...tx(hashOf(4), mergeLogs(EXECUTOR, PARENT_TOKENS, 50n, BLOCK + 5)),
    ]);

    t.expect(await costOf(indexer)).toBe(0n);
  });
});
