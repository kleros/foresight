"use client";

import { skipToken, useInfiniteQuery } from "@tanstack/react-query";

import { fetchGraphql } from "@/lib/graphql/batcher";
import { graphql } from "@/lib/graphql/generated";
import { STALE_TIME } from "@/lib/query";

import { gnosisRouterAddresses } from "@/config/contracts";

import type { SessionTrade } from "../types";
import {
  FIRST_PAGE,
  KEYS_READ,
  pageKeys,
  toSessionTrades,
  type TradeKey,
  type TradesCursor,
} from "../utils/toSessionTrades";

const SESSION_TRADE_KEYS = graphql(`
  query SessionTradeKeys($sessionId: String!, $predictionOffset: Int!, $externalOffset: Int!, $limit: Int!) {
    Prediction(
      where: { childMarket: { session_id: { _eq: $sessionId } } }
      distinct_on: [blockNumber, transactionHash, executor_id]
      order_by: [{ blockNumber: desc }, { transactionHash: desc }, { executor_id: asc }]
      offset: $predictionOffset
      limit: $limit
    ) {
      blockNumber
      transactionHash
      executor_id
    }
    Swap(
      where: { childMarket: { session_id: { _eq: $sessionId } }, executor_id: { _is_null: true } }
      distinct_on: [blockNumber, transactionHash]
      order_by: [{ blockNumber: desc }, { transactionHash: desc }]
      offset: $externalOffset
      limit: $limit
    ) {
      blockNumber
      transactionHash
    }
  }
`);

const SESSION_TRADE_ROWS = graphql(`
  query SessionTradeRows(
    $sessionId: String!
    $predictionTxs: [String!]!
    $externalTxs: [String!]!
    $routers: [String!]!
  ) {
    Prediction(
      where: { childMarket: { session_id: { _eq: $sessionId } }, transactionHash: { _in: $predictionTxs } }
      order_by: [{ transactionHash: desc }, { executor_id: asc }, { childMarket_id: asc }]
    ) {
      transactionHash
      blockNumber
      timestamp
      childMarket_id
      childMarket {
        downToken
        upToken
      }
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
    predictionSwaps: Swap(
      where: {
        childMarket: { session_id: { _eq: $sessionId } }
        transactionHash: { _in: $predictionTxs }
        executor_id: { _is_null: false }
      }
      order_by: [{ logIndex: asc }]
    ) {
      transactionHash
      executor_id
      childMarket_id
      logIndex
      outcomeAmount
      underlyingAmount
      pool {
        outcomeIndex
      }
    }
    externalSwaps: Swap(
      where: {
        childMarket: { session_id: { _eq: $sessionId } }
        transactionHash: { _in: $externalTxs }
        executor_id: { _is_null: true }
      }
      order_by: [{ logIndex: asc }]
    ) {
      transactionHash
      blockNumber
      timestamp
      sender
      childMarket_id
      outcomeAmount
      underlyingAmount
      pool {
        outcomeIndex
      }
    }
    Transfer(where: { transactionHash: { _in: $predictionTxs }, counterparty: { _in: $routers } }) {
      id
      transactionHash
      executor_id
      token
      amount
    }
  }
`);

export const sessionTradesKey = (sessionId?: string) => ["session-trades", sessionId] as const;

/** Mints and merges reach a trade wallet from Seer's router, lowercase as the indexer stores a counterparty. */
export const routerCounterparties = (): string[] => gnosisRouterAddresses().map((router) => router.toLowerCase());

const hashesOf = (page: TradeKey[], kind: TradeKey["kind"]) => [
  ...new Set(page.filter((key) => key.kind === kind).map((key) => key.transactionHash)),
];

/** One page of the session's trades, newest first, and where the next page starts; null at the end. */
export async function fetchSessionTrades(
  sessionId: string,
  cursor: TradesCursor = FIRST_PAGE,
): Promise<{ trades: SessionTrade[]; next: TradesCursor | null }> {
  const keys = await fetchGraphql(SESSION_TRADE_KEYS, {
    sessionId,
    predictionOffset: cursor.predictions,
    externalOffset: cursor.externals,
    limit: KEYS_READ,
  });
  const { page, next } = pageKeys(keys, cursor);
  if (page.length === 0) return { trades: [], next };
  const rows = await fetchGraphql(SESSION_TRADE_ROWS, {
    sessionId,
    predictionTxs: hashesOf(page, "prediction"),
    externalTxs: hashesOf(page, "external"),
    routers: routerCounterparties(),
  });
  return { trades: toSessionTrades(page, rows), next };
}

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
