import type { Address } from "viem";

import type { SessionTradesQuery } from "@/lib/graphql/generated/graphql";

import type { ExternalTrade, PredictionTrade, SessionTrade, TradeOption } from "../types";

/** Trades a page shows at most, and the swap rows read for it: one row per external swap. */
export const TRADE_PAGE = 20;
/** Prediction rows read per page; a prediction takes one row per option it traded. */
export const PREDICTION_ROWS = TRADE_PAGE * 2;

/** How many rows of each table earlier pages used. */
export interface TradesCursor {
  predictions: number;
  swaps: number;
}

export const FIRST_PAGE: TradesCursor = { predictions: 0, swaps: 0 };

type PredictionRow = SessionTradesQuery["Prediction"][number];
type SwapRow = SessionTradesQuery["Swap"][number];

const lower = (value: string) => value.toLowerCase() as Address;
const optional = (value: string | null | undefined) => (value == null ? null : BigInt(value));

function toOption(row: PredictionRow): TradeOption {
  return {
    childMarket: lower(row.childMarket_id),
    underlyingDelta: BigInt(row.underlyingDelta),
    downDelta: BigInt(row.downDelta),
    upDelta: BigInt(row.upDelta),
    downBalance: BigInt(row.downBalance),
    upBalance: BigInt(row.upBalance),
    downSwapUnderlying: BigInt(row.downSwapUnderlying),
    downSwapTokens: BigInt(row.downSwapTokens),
    upSwapUnderlying: BigInt(row.upSwapUnderlying),
    upSwapTokens: BigInt(row.upSwapTokens),
    downAvgPrice: optional(row.downAvgPrice),
    upAvgPrice: optional(row.upAvgPrice),
    downPriceBefore: optional(row.downPriceBefore),
    downPriceAfter: optional(row.downPriceAfter),
    upPriceBefore: optional(row.upPriceBefore),
    upPriceAfter: optional(row.upPriceAfter),
  };
}

/** Rows arrive ordered by transaction then trade wallet, so each prediction's rows are adjacent. */
function toPredictions(rows: PredictionRow[]): { trade: PredictionTrade; rows: number }[] {
  const groups: { trade: PredictionTrade; rows: number }[] = [];
  for (const row of rows) {
    const id = `${row.transactionHash}-${row.executor_id}`.toLowerCase();
    const option = toOption(row);
    const last = groups.at(-1);
    if (last?.trade.id === id) {
      last.trade.options.push(option);
      last.trade.underlyingDelta += option.underlyingDelta;
      last.rows += 1;
      continue;
    }
    groups.push({
      rows: 1,
      trade: {
        kind: "prediction",
        id,
        transactionHash: row.transactionHash,
        blockNumber: BigInt(row.blockNumber),
        timestamp: Number(row.timestamp),
        owner: lower(row.executor?.owner ?? row.executor_id),
        options: [option],
        underlyingDelta: option.underlyingDelta,
      },
    });
  }
  return groups;
}

function toExternal(row: SwapRow): ExternalTrade {
  const underlying = BigInt(row.underlyingAmount);
  return {
    kind: "external",
    id: row.id,
    transactionHash: row.transactionHash,
    blockNumber: BigInt(row.blockNumber),
    timestamp: Number(row.timestamp),
    sender: row.sender ? lower(row.sender) : null,
    childMarket: lower(row.childMarket_id),
    // the indexer's outcomeIndex: 0 is DOWN, 1 is UP
    side: row.pool?.outcomeIndex === 1 ? "UP" : "DOWN",
    // amounts are signed from the pool's side: the pool paying outcome tokens out is a buy
    bought: BigInt(row.outcomeAmount) < 0n,
    underlying: underlying < 0n ? -underlying : underlying,
  };
}

/**
 * One page of trades, newest first: predictions and external swaps merged by block, a prediction before a
 * swap in the same block. A full prediction read may hold more, so the page stops where its rows run out,
 * and its last prediction, which may continue past the read, is left to the next page.
 */
export function toSessionTrades(
  result: SessionTradesQuery,
  cursor: TradesCursor,
): { trades: SessionTrade[]; next: TradesCursor | null } {
  const predictionsFull = result.Prediction.length === PREDICTION_ROWS;
  const swapsFull = result.Swap.length === TRADE_PAGE;
  const all = toPredictions(result.Prediction);
  // a single prediction filling the read is shown as read rather than never
  const predictions = predictionsFull && all.length > 1 ? all.slice(0, -1) : all;
  const swaps = result.Swap.map(toExternal);

  const trades: SessionTrade[] = [];
  let taken = 0;
  let rowsTaken = 0;
  let swapsTaken = 0;
  while (trades.length < TRADE_PAGE) {
    const prediction = predictions[taken];
    const swap = swaps[swapsTaken];
    if ((!prediction && predictionsFull) || (!prediction && !swap)) break;
    if (prediction && (!swap || prediction.trade.blockNumber >= swap.blockNumber)) {
      trades.push(prediction.trade);
      rowsTaken += prediction.rows;
      taken += 1;
    } else {
      trades.push(swap!);
      swapsTaken += 1;
    }
  }

  const more = predictionsFull || swapsFull || taken < predictions.length || swapsTaken < swaps.length;
  return {
    trades,
    next: more ? { predictions: cursor.predictions + rowsTaken, swaps: cursor.swaps + swapsTaken } : null,
  };
}
