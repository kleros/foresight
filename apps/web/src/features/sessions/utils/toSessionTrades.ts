import type { Address } from "viem";

import type { SessionTradeKeysQuery, SessionTradeRowsQuery } from "@/lib/graphql/generated/graphql";

import type { ExternalTrade, PoolSide, PredictionTrade, SessionTrade, TradeOptionDetail } from "../types";
import { optionCost, tradeOperations, type RouterTransfer, type SwapLog } from "./tradeDetail";

/** Trades a page shows at most. */
export const TRADE_PAGE = 20;
/** Keys read of each kind per page: one past a page, so a read that ends on a page's last trade offers no next page. */
export const KEYS_READ = TRADE_PAGE + 1;

/** How many predictions and how many external transactions earlier pages showed. */
export interface TradesCursor {
  predictions: number;
  externals: number;
}

export const FIRST_PAGE: TradesCursor = { predictions: 0, externals: 0 };

/** A trade a page shows, named before its rows are read. */
export type TradeKey =
  { kind: "prediction"; transactionHash: string; executor: string } | { kind: "external"; transactionHash: string };

type PredictionRow = SessionTradeRowsQuery["Prediction"][number];
type SwapRow = SessionTradeRowsQuery["predictionSwaps"][number];
type ExternalSwapRow = SessionTradeRowsQuery["externalSwaps"][number];
type TransferRow = SessionTradeRowsQuery["Transfer"][number];

const lower = (value: string) => value.toLowerCase() as Address;
const optional = (value: string | null | undefined) => (value == null ? null : BigInt(value));
const abs = (value: bigint) => (value < 0n ? -value : value);
// the indexer's outcomeIndex: 0 is DOWN, 1 is UP
const sideOf = (outcomeIndex: number | null | undefined): PoolSide => (outcomeIndex === 1 ? "UP" : "DOWN");
// Transfer ids are transactionHash-logIndex-executor (apps/indexer/src/utils/ids.ts)
const transferLogIndex = (id: string) => Number(id.split("-")[1]);

/**
 * One page of trades, newest first: both kinds' keys merged by block, a prediction before an external transaction
 * in the same block, and the cursor past them; null once both kinds are read to the end.
 */
export function pageKeys(
  keys: SessionTradeKeysQuery,
  cursor: TradesCursor,
): { page: TradeKey[]; next: TradesCursor | null } {
  const page: TradeKey[] = [];
  let predictions = 0;
  let externals = 0;
  while (page.length < TRADE_PAGE) {
    const prediction = keys.Prediction[predictions];
    const external = keys.Swap[externals];
    if (prediction && (!external || BigInt(prediction.blockNumber) >= BigInt(external.blockNumber))) {
      page.push({ kind: "prediction", transactionHash: prediction.transactionHash, executor: prediction.executor_id });
      predictions += 1;
    } else if (external) {
      page.push({ kind: "external", transactionHash: external.transactionHash });
      externals += 1;
    } else {
      break;
    }
  }
  const more = predictions < keys.Prediction.length || externals < keys.Swap.length;
  return {
    page,
    next: more ? { predictions: cursor.predictions + predictions, externals: cursor.externals + externals } : null,
  };
}

const predictionKey = (transactionHash: string, executor: string) => `${transactionHash}-${executor}`.toLowerCase();
const optionKey = (transactionHash: string, executor: string, childMarket: string) =>
  `${predictionKey(transactionHash, executor)}-${childMarket.toLowerCase()}`;

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(key(item));
    if (group) group.push(item);
    else groups.set(key(item), [item]);
  }
  return groups;
}

function routerTransfers(row: PredictionRow, transfers: TransferRow[]): RouterTransfer[] {
  const down = row.childMarket?.downToken.toLowerCase();
  const up = row.childMarket?.upToken.toLowerCase();
  return transfers.flatMap((transfer): RouterTransfer[] => {
    const token = transfer.token.toLowerCase();
    const side = token === up ? "UP" : token === down ? "DOWN" : null;
    return side ? [{ logIndex: transferLogIndex(transfer.id), side, amount: BigInt(transfer.amount) }] : [];
  });
}

function toOption(row: PredictionRow, swaps: SwapRow[], transfers: TransferRow[]): TradeOptionDetail {
  const logs = swaps.map((swap): SwapLog => ({
    logIndex: swap.logIndex,
    side: sideOf(swap.pool?.outcomeIndex),
    outcomeAmount: BigInt(swap.outcomeAmount),
    underlyingAmount: BigInt(swap.underlyingAmount),
  }));
  return {
    childMarket: lower(row.childMarket_id),
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
    operations: tradeOperations(logs, routerTransfers(row, transfers)),
  };
}

/**
 * Prediction rows grouped into one trade per transaction and trade wallet, in the order the rows came, each option
 * with the swaps that paid out to that wallet in that market and the router transfers of its DOWN and UP.
 */
export function toPredictions(rows: PredictionRow[], swaps: SwapRow[], transfers: TransferRow[]): PredictionTrade[] {
  const swapsOf = groupBy(swaps, (swap) =>
    optionKey(swap.transactionHash, swap.executor_id ?? "", swap.childMarket_id),
  );
  const transfersOf = groupBy(transfers, (transfer) => predictionKey(transfer.transactionHash, transfer.executor_id));
  const trades = new Map<string, PredictionTrade>();
  for (const row of rows) {
    const id = predictionKey(row.transactionHash, row.executor_id);
    const option = toOption(
      row,
      swapsOf.get(optionKey(row.transactionHash, row.executor_id, row.childMarket_id)) ?? [],
      transfersOf.get(id) ?? [],
    );
    const trade = trades.get(id);
    if (trade) {
      trade.options.push(option);
      trade.cost += optionCost(option);
      continue;
    }
    trades.set(id, {
      kind: "prediction",
      id,
      transactionHash: row.transactionHash,
      blockNumber: BigInt(row.blockNumber),
      timestamp: Number(row.timestamp),
      executor: lower(row.executor_id),
      owner: lower(row.executor?.owner ?? row.executor_id),
      options: [option],
      cost: optionCost(option),
    });
  }
  return [...trades.values()];
}

/** External swaps grouped into one trade per transaction, its legs in the order the swaps came. */
export function toExternals(swaps: ExternalSwapRow[]): ExternalTrade[] {
  const trades = new Map<string, ExternalTrade>();
  for (const swap of swaps) {
    const leg = {
      childMarket: lower(swap.childMarket_id),
      side: sideOf(swap.pool?.outcomeIndex),
      // amounts are signed from the pool's side: the pool paying outcome tokens out is a buy
      bought: BigInt(swap.outcomeAmount) < 0n,
      underlying: abs(BigInt(swap.underlyingAmount)),
    };
    const trade = trades.get(swap.transactionHash);
    if (trade) {
      trade.legs.push(leg);
      continue;
    }
    trades.set(swap.transactionHash, {
      kind: "external",
      id: swap.transactionHash,
      transactionHash: swap.transactionHash,
      blockNumber: BigInt(swap.blockNumber),
      timestamp: Number(swap.timestamp),
      sender: swap.sender ? lower(swap.sender) : null,
      legs: [leg],
    });
  }
  return [...trades.values()];
}

/** The page's trades in its keys' order; a key whose rows did not come back is left out. */
export function toSessionTrades(page: TradeKey[], rows: SessionTradeRowsQuery): SessionTrade[] {
  const predictions = new Map(
    toPredictions(rows.Prediction, rows.predictionSwaps, rows.Transfer).map((trade) => [trade.id, trade]),
  );
  const externals = new Map(toExternals(rows.externalSwaps).map((trade) => [trade.id, trade]));
  return page.flatMap((key): SessionTrade[] => {
    const trade =
      key.kind === "prediction"
        ? predictions.get(predictionKey(key.transactionHash, key.executor))
        : externals.get(key.transactionHash);
    return trade ? [trade] : [];
  });
}
