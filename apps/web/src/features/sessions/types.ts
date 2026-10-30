import type { DisplayBlock } from "@foresight/session-metadata";
import type { Address } from "viem";

import type { OptionScale } from "@/types/optionScale";

export type SessionStatus = "setting-up" | "trading" | "closed";

/** The fields every session read shares, whichever query fetched it. */
export interface SessionCore {
  /** The `sessionId` the factory assigned, which is also the entity id. */
  id: string;
  parentMarket: Address;
  deployer: Address;
  /** Metadata title, or the market name where metadata did not resolve. */
  name: string;
  /** Metadata description; null where metadata carried none. */
  description: string | null;
  /** Gateway URL, or null where there is no image or the uri was refused. */
  iconUri: string | null;
  heroUri: string | null;
  /** When trading stops */
  closesAt: Date | null;
}

/** One child market */
export interface SessionOption extends OptionScale {
  outcomeIndex: number;
  question: string;
  upToken: Address | null;
  downToken: Address | null;
  /** Burnt with UP and DOWN when a set is merged back; the router takes the whole partition. */
  invalidToken: Address | null;
  underlyingToken: Address | null;
  /** Display blocks with image uris already resolved against the gateway. */
  blocks: DisplayBlock[];
}

export interface SessionDetail extends SessionCore {
  question: string;
  itemName: string | null;
  itemNamePlural: string | null;
  /** False when the metadata document was unreachable or malformed. */
  metadataResolved: boolean;
  outcomeCount: number;
  deployedChildCount: number;
  /** True once every child market exists; until then the session cannot be traded. */
  setupComplete: boolean;
  openedAt: Date;
  /** The seer factory's collateral behind every market here; null where the read failed. */
  collateralToken: Address | null;
  collateralDecimals: number | null;
  collateralSymbol: string | null;
  /** The decision's INVALID outcome token */
  invalidToken: Address | null;
  /** Session-level display blocks, image uris already resolved against the gateway. */
  blocks: DisplayBlock[];
  options: SessionOption[];
}

export type SessionChartOption = OptionScale;

export interface SessionChartPoint {
  /** Unix seconds. */
  timestamp: number;
  /** Market estimate in the option's own unit. */
  value: number;
}

/** One option's estimate history, oldest first. */
export interface SessionChartSeries {
  option: SessionChartOption;
  points: SessionChartPoint[];
}

/** One series per option; an option whose pool never priced has no points. */
export type SessionChartData = SessionChartSeries[];

export type PoolSide = "UP" | "DOWN";

/** One option's UP or DOWN pool, as the indexer serves it; addresses lowercase. */
export interface SessionPool {
  id: Address;
  market: Address;
  side: PoolSide;
  outcomeToken: Address;
  underlyingToken: Address;
  /** Underlying per outcome token, 1e18-scaled; null until the pool prices. */
  underlyingPerOutcome: bigint | null;
  /** Lifetime amount swapped either way, in wei of each leg. */
  volumeUnderlying: bigint;
  volumeOutcome: bigint;
}

export interface SessionStats {
  /** Executors that have predicted in this session. */
  traders: number;
  /** Lifetime amount swapped through the session's pools, in underlying wei. */
  volumeUnderlying: bigint;
  /** The same swaps' outcome-token leg, in outcome-token wei. */
  volumeOutcome: bigint;
  pools: SessionPool[];
}

/** One option's slice of a prediction, as the indexer's `Prediction` row holds it; amounts in wei, prices 1e18-scaled. */
export interface TradeOption {
  childMarket: Address;
  /** Signed net movements over the transaction, positive into the trade wallet. */
  downDelta: bigint;
  upDelta: bigint;
  /** Balances once the transaction settled. */
  downBalance: bigint;
  upBalance: bigint;
  /** Totals over the side's swaps, signed from the trade wallet's side. */
  downSwapUnderlying: bigint;
  downSwapTokens: bigint;
  upSwapUnderlying: bigint;
  upSwapTokens: bigint;
  downAvgPrice: bigint | null;
  upAvgPrice: bigint | null;
  /** Pool prices before the side's first swap and after its last; null where the side did not swap. */
  downPriceBefore: bigint | null;
  downPriceAfter: bigint | null;
  upPriceBefore: bigint | null;
  upPriceAfter: bigint | null;
}

/** One transaction by one trade wallet, across every option it touched. */
export interface PredictionTrade {
  kind: "prediction";
  /** `transactionHash-executor` */
  id: string;
  transactionHash: string;
  blockNumber: bigint;
  /** Unix seconds. */
  timestamp: number;
  /** The account that owns the trade wallet. */
  owner: Address;
  options: TradeOption[];
  /** The options' `optionCost`, summed: underlying put in, negative where more came out. */
  cost: bigint;
}

/** A swap straight through a pool, outside any trade wallet. */
export interface ExternalTrade {
  kind: "external";
  id: string;
  transactionHash: string;
  blockNumber: bigint;
  timestamp: number;
  /** The transaction's sender; null where the indexer did not record one. */
  sender: Address | null;
  childMarket: Address;
  side: PoolSide;
  bought: boolean;
  /** Underlying paid or received, in wei. */
  underlying: bigint;
}

export type SessionTrade = PredictionTrade | ExternalTrade;

/** A pool's own holdings, keyed by lowercase pool address. */
export type PoolBalances = Record<string, { outcome: bigint; underlying: bigint }>;

export interface SessionSummary extends SessionCore {
  branchCount: number;
  /** Plural, e.g. "Movies". */
  branchNoun: string;
  keyword: string;
}
