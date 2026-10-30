"use client";

import { skipToken, useInfiniteQuery } from "@tanstack/react-query";

import { fetchGraphql } from "@/lib/graphql/batcher";
import { graphql } from "@/lib/graphql/generated";
import { STALE_TIME } from "@/lib/query";

import type { SessionTrade } from "../types";
import { FIRST_PAGE, PREDICTION_ROWS, TRADE_PAGE, toSessionTrades, type TradesCursor } from "../utils/toSessionTrades";

const SESSION_TRADES = graphql(`
  query SessionTrades(
    $sessionId: String!
    $predictionOffset: Int!
    $swapOffset: Int!
    $predictionLimit: Int!
    $swapLimit: Int!
  ) {
    Prediction(
      where: { childMarket: { session_id: { _eq: $sessionId } } }
      order_by: [{ blockNumber: desc }, { transactionHash: desc }, { executor_id: asc }, { childMarket_id: asc }]
      offset: $predictionOffset
      limit: $predictionLimit
    ) {
      transactionHash
      blockNumber
      timestamp
      childMarket_id
      executor_id
      executor {
        owner
      }
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
    Swap(
      where: { childMarket: { session_id: { _eq: $sessionId } }, executor_id: { _is_null: true } }
      order_by: [{ blockNumber: desc }, { logIndex: desc }]
      offset: $swapOffset
      limit: $swapLimit
    ) {
      id
      transactionHash
      blockNumber
      timestamp
      childMarket_id
      sender
      outcomeAmount
      underlyingAmount
      pool {
        outcomeIndex
      }
    }
  }
`);

export const sessionTradesKey = (sessionId?: string) => ["session-trades", sessionId] as const;

/** One page of the session's trades, newest first, and where the next page starts; null at the end. */
export const fetchSessionTrades = async (sessionId: string, cursor: TradesCursor = FIRST_PAGE) =>
  toSessionTrades(
    await fetchGraphql(SESSION_TRADES, {
      sessionId,
      predictionOffset: cursor.predictions,
      swapOffset: cursor.swaps,
      predictionLimit: PREDICTION_ROWS,
      swapLimit: TRADE_PAGE,
    }),
    cursor,
  );

/** Pages are read by offset, so a trade landing between reads shifts the next page onto rows already shown. */
const unique = (trades: SessionTrade[]) => {
  const seen = new Set<string>();
  return trades.filter((trade) => !seen.has(trade.id) && Boolean(seen.add(trade.id)));
};

export function useSessionTrades(sessionId: string | undefined) {
  return useInfiniteQuery({
    queryKey: sessionTradesKey(sessionId),
    queryFn: sessionId ? ({ pageParam }) => fetchSessionTrades(sessionId, pageParam) : skipToken,
    initialPageParam: FIRST_PAGE,
    getNextPageParam: (page) => page.next ?? undefined,
    select: (data) => unique(data.pages.flatMap((page) => page.trades)),
    staleTime: STALE_TIME.live,
  });
}
