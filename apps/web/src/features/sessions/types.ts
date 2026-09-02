import type { Address } from "viem";

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
export interface SessionOption {
  market: Address;
  outcomeIndex: number;
  name: string;
  color: string;
  question: string;
  /** Parsed from the market name's `[unit]` suffix; null where the name carries none. */
  unit: string | null;
  /** Scalar bounds in the unit's own terms, de-scaled from 1e18. */
  lowerBound: number;
  upperBound: number;
  upToken: Address | null;
  downToken: Address | null;
  underlyingToken: Address | null;
  blocks: unknown;
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
  /** Session-level display blocks from the metadata document. */
  blocks: unknown;
  options: SessionOption[];
}

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
