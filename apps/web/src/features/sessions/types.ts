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

export interface SessionStats {
  /** Executors that have predicted in this session. */
  traders: number;
  /** Lifetime amount swapped through the session's pools, in underlying wei. */
  volumeUnderlying: bigint;
}

export interface SessionSummary extends SessionCore {
  branchCount: number;
  /** Plural, e.g. "Movies". */
  branchNoun: string;
  keyword: string;
}
