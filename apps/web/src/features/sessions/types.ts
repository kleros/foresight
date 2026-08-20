import type { Address } from "viem";

export interface SessionSummary {
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
  branchCount: number;
  /** Plural, e.g. "Movies". */
  branchNoun: string;
  keyword: string;
  closesAt: Date | null;
}
