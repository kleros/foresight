"use client";

import type { Address } from "viem";

import { fetchGraphql } from "@/lib/graphql/batcher";
import { graphql } from "@/lib/graphql/generated";
import type { PoolRef } from "@/lib/swap/algebraPool";

/**
 * Where each option's two pools are, and which way round their tokens sit. Both are fixed once
 * the pool exists, so the indexer is the cheapest place to look them up; the price and the
 * liquidity are read from the chain, where they are current.
 */
const SESSION_POOLS = graphql(`
  query SessionPools($sessionId: String!) {
    Pool(where: { childMarket: { session_id: { _eq: $sessionId } } }) {
      id
      childMarket_id
      outcomeIndex
      outcomeIsToken0
    }
  }
`);

/** outcomeIndex 1 is UP and 0 is DOWN, the order Seer wraps a scalar market's outcomes in. */
const UP_OUTCOME = 1;

export type OptionPoolRefs = { up?: PoolRef; down?: PoolRef };

export type PoolRefsByMarket = Record<string, OptionPoolRefs>;

export async function fetchSessionPools(sessionId: string): Promise<PoolRefsByMarket> {
  const result = await fetchGraphql(SESSION_POOLS, { sessionId });

  const byMarket: PoolRefsByMarket = {};
  for (const pool of result.Pool) {
    const side = pool.outcomeIndex === UP_OUTCOME ? "up" : "down";
    byMarket[pool.childMarket_id] = {
      ...byMarket[pool.childMarket_id],
      [side]: { address: pool.id as Address, outcomeIsToken0: pool.outcomeIsToken0 },
    };
  }

  return byMarket;
}

/** An option whose pools were never created has neither side, which leaves both untradeable. */
export function optionPoolRefs(byMarket: PoolRefsByMarket, childMarket: string): OptionPoolRefs {
  return byMarket[childMarket.toLowerCase()] ?? {};
}
