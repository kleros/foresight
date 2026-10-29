"use client";

import { skipToken, useQuery } from "@tanstack/react-query";
import type { Address } from "viem";

import { fetchGraphql } from "@/lib/graphql/batcher";
import { graphql } from "@/lib/graphql/generated";
import { STALE_TIME } from "@/lib/query";

import { sessionTradesKey } from "./getSessionTrades";
import { toPredictions } from "../utils/toSessionTrades";

const WALLET_TRADES = graphql(`
  query WalletTrades($sessionId: String!, $executor: String!, $tokens: [String!]!) {
    Prediction(
      where: { childMarket: { session_id: { _eq: $sessionId } }, executor_id: { _eq: $executor } }
      order_by: [{ blockNumber: desc }, { transactionHash: desc }, { executor_id: asc }, { childMarket_id: asc }]
    ) {
      transactionHash
      blockNumber
      timestamp
      childMarket_id
      executor_id
      executor {
        owner
      }
      underlyingDelta
      downDelta
      upDelta
      downBalance
      upBalance
      downSwapUnderlying
      downSwapTokens
      upSwapUnderlying
      upSwapTokens
      downAvgPrice
      upAvgPrice
      downPriceBefore
      downPriceAfter
      upPriceBefore
      upPriceAfter
    }
    Position(where: { executor_id: { _eq: $executor }, token: { _in: $tokens } }) {
      token
      balance
    }
  }
`);

/**
 * Every prediction one trade wallet made in the session, newest first, and its balance of each of `tokens`
 * keyed by lowercase address, read together so the two describe the same indexed block.
 */
export function useWalletTrades(sessionId: string | undefined, executor: Address | undefined, tokens: Address[]) {
  return useQuery({
    // under the session's trades key, so whatever refreshes the trades refreshes this too
    queryKey: [...sessionTradesKey(sessionId), "wallet", executor, tokens],
    queryFn:
      sessionId && executor
        ? async () => {
            const result = await fetchGraphql(WALLET_TRADES, {
              sessionId,
              executor: executor.toLowerCase(),
              tokens: tokens.map((token) => token.toLowerCase()),
            });
            return {
              trades: toPredictions(result.Prediction).map((group) => group.trade),
              balances: Object.fromEntries(
                result.Position.map((row) => [row.token.toLowerCase(), BigInt(row.balance)]),
              ) as Record<string, bigint>,
            };
          }
        : skipToken,
    staleTime: STALE_TIME.live,
  });
}
