import type { Address } from "viem";

import type { SessionStatsQuery } from "@/lib/graphql/generated/graphql";

import type { SessionStats } from "../types";

const lower = (value: string) => value.toLowerCase() as Address;

const predictors = (result: SessionStatsQuery) => result.Prediction.map((row) => row.executor?.owner);

// Covers swaps made outside foresight; remove it with the directSwaps and senderlessSwaps fields.
const directSwappers = (result: SessionStatsQuery) => [
  ...result.directSwaps.map((row) => row.sender),
  ...result.senderlessSwaps.map((row) => row.executor?.owner),
];

const countTraders = (result: SessionStatsQuery) => {
  const addresses = [...predictors(result), ...directSwappers(result)];
  return new Set(addresses.flatMap((address) => (address ? [address.toLowerCase()] : []))).size;
};

export function toSessionStats(result: SessionStatsQuery): SessionStats {
  const pools = result.Pool.map((pool) => ({
    id: lower(pool.id),
    market: lower(pool.childMarket_id),
    // the indexer's outcomeIndex: 0 is DOWN, 1 is UP
    side: pool.outcomeIndex === 1 ? ("UP" as const) : ("DOWN" as const),
    outcomeToken: lower(pool.outcomeToken),
    underlyingToken: lower(pool.underlyingToken),
    underlyingPerOutcome: pool.underlyingPerOutcome == null ? null : BigInt(pool.underlyingPerOutcome),
    volumeUnderlying: BigInt(pool.volumeUnderlying),
    volumeOutcome: BigInt(pool.volumeOutcome),
  }));
  return {
    traders: countTraders(result),
    volumeUnderlying: pools.reduce((sum, pool) => sum + pool.volumeUnderlying, 0n),
    volumeOutcome: pools.reduce((sum, pool) => sum + pool.volumeOutcome, 0n),
    pools,
  };
}
