import { createTestIndexer } from "envio";
import { type Address } from "viem";

type TestIndexer = ReturnType<typeof createTestIndexer>;

/**
 * Blocks sit far above any local deploy. config.localhost.yaml's `start_block` is generated from
 * whichever block the hardhat deploy landed on, and an event below it is filtered out
 * before any handler runs - the test indexer also refuses a `startBlock` under the
 * config's, so headroom is the way to stay independent of it.
 */
export const BLOCK = 1_000;

export const OWNER = "0x0000000000000000000000000000000000000e01" as const;
export const OTHER_OWNER = "0x0000000000000000000000000000000000000e02" as const;
export const EXECUTOR = "0x00000000000000000000000000000000000000e1" as const;
export const OTHER_EXECUTOR = "0x00000000000000000000000000000000000000e2" as const;

export const CHILD_MARKET = "0x0000000000000000000000000000000000000c00" as const;
export const UNDERLYING = "0x0000000000000000000000000000000000005da1" as const;
export const UP = "0x0000000000000000000000000000000000000117" as const;
export const DOWN = "0x0000000000000000000000000000000000000118" as const;

export const OTHER_MARKET = "0x0000000000000000000000000000000000000c01" as const;
export const OTHER_UNDERLYING = "0x0000000000000000000000000000000000005da2" as const;
export const OTHER_UP = "0x0000000000000000000000000000000000000217" as const;
export const OTHER_DOWN = "0x0000000000000000000000000000000000000218" as const;

export const POOL = "0x0000000000000000000000000000000000000900" as const;
export const UP_POOL = "0x0000000000000000000000000000000000009901" as const;
export const DOWN_POOL = "0x0000000000000000000000000000000000009902" as const;
export const OTHER_POOL = "0x0000000000000000000000000000000000009903" as const;
export const ROUTER = "0x0000000000000000000000000000000000004004" as const;
export const STRANGER_POOL = "0x0000000000000000000000000000000000008888" as const;
export const STRANGER_TOKEN = "0x0000000000000000000000000000000000007777" as const;
export const UNKNOWN_TOKEN = "0x0000000000000000000000000000000000009999" as const;
export const SDAI = "0x000000000000000000000000000000000000ada1" as const;

export const executorDeployed = (owner: Address, executor: Address, block = BLOCK) => ({
  contract: "TradeExecutorFactory" as const,
  event: "ExecutorDeployed" as const,
  block: { number: block, timestamp: block },
  params: { owner, executor },
});

export const transfer = (token: Address, from: Address, to: Address, value: bigint, block = BLOCK) => ({
  contract: "TradeExecutor" as const,
  event: "Transfer" as const,
  srcAddress: token,
  block: { number: block, timestamp: block },
  params: { from, to, value },
});

export const poolCreated = (token0: Address, token1: Address, pool: Address) => ({
  contract: "AlgebraFactory" as const,
  event: "Pool" as const,
  block: { number: BLOCK, timestamp: BLOCK },
  params: { token0, token1, pool },
});

export const initialized = (pool: Address, price: bigint) => ({
  contract: "AlgebraPool" as const,
  event: "Initialize" as const,
  srcAddress: pool,
  block: { number: BLOCK + 1, timestamp: BLOCK + 1 },
  params: { price, tick: 0n },
});

export const swapped = (
  pool: Address,
  recipient: Address,
  price: bigint,
  tick: bigint,
  block = BLOCK + 2,
  amounts = { amount0: -10n, amount1: 25n },
) => ({
  contract: "AlgebraPool" as const,
  event: "Swap" as const,
  srcAddress: pool,
  block: { number: block, timestamp: block },
  params: { sender: pool, recipient, ...amounts, price, liquidity: 1_000n, tick },
});

type Simulated =
  | ReturnType<typeof executorDeployed>
  | ReturnType<typeof transfer>
  | ReturnType<typeof poolCreated>
  | ReturnType<typeof initialized>
  | ReturnType<typeof swapped>;

export const indexEvents = (indexer: TestIndexer, simulate: Simulated[]) =>
  indexer.process({ chains: { 31337: { simulate } } });

/** Bounds and token addresses feed assertions, so every suite spells its own; the rest is inert. */
export type SeededMarket = {
  id: string;
  down: string;
  up: string;
  underlying: string;
  lowerBound: bigint;
  upperBound: bigint;
};

export const seedMarket = async (indexer: TestIndexer, market: SeededMarket) => {
  await indexer.ChildMarket.set({
    id: market.id,
    session_id: "0",
    parentOutcomeIndex: 0n,
    parentOutcome: "Villeneuve",
    deployedAt: BigInt(BLOCK),
    marketName: "Opening weekend [USD millions]",
    lowerBound: market.lowerBound,
    upperBound: market.upperBound,
    downToken: market.down,
    upToken: market.up,
    invalidToken: `${market.id}-invalid`,
    underlyingToken: market.underlying,
    displayName: undefined,
    color: undefined,
    blocks: [],
    keyword: "",
    transactionHash: "0x",
  });

  await indexer.Token.set({ id: market.down, childMarket_id: market.id, outcomeIndex: 0, decimals: 18, symbol: "UP" });
  await indexer.Token.set({ id: market.up, childMarket_id: market.id, outcomeIndex: 1, decimals: 18, symbol: "DOWN" });
  await indexer.Token.set({
    id: market.underlying,
    childMarket_id: undefined,
    outcomeIndex: undefined,
    decimals: 18,
    symbol: "sDAI",
  });
};

/** Pool-signed swap amounts, for pools created with the underlying as token0. */
export const bought = (underlying: bigint, tokens: bigint) => ({ amount0: underlying, amount1: -tokens });

/** Simulated events share the harness default transaction unless one is set, so a lone row is the row. */
export const onlyPrediction = async (indexer: TestIndexer) => {
  const predictions = await indexer.Prediction.getAll();
  if (predictions.length !== 1) {
    throw new Error(`expected one prediction, got ${predictions.length}`);
  }

  return predictions[0]!;
};
