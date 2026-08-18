import type { Address } from "viem";

/**
 * The deploy input, already resolved.
 *
 * Every string is final and every number scaled: the wizard does its parsing,
 * unit composition and bigint scaling before it gets here, so this package only
 * ever formats and encodes. That keeps the on-chain shape testable without a
 * form, and keeps the form's half-typed values out of the deploy path.
 */

export type ParentMarketInput = {
  marketName: string;
  outcomes: string[];
  tokenNames: string[];
  category: string;
  lang: string;
  minBond: bigint;
  /** Seconds. Reality opening time; the end of the trading period. */
  openingTime: number;
};

export type ChildMarketInput = {
  parentOutcomeIndex: number;
  /** Composed as `question [unit]`, the unit convention Seer answerers rely on. */
  marketName: string;
  /** Two names, for the DOWN and UP outcome tokens. */
  tokenNames: [string, string];
  lowerBound: bigint;
  upperBound: bigint;
  minBond: bigint;
  openingTime: number;
  category: string;
  lang: string;
};

export type SessionDeployInput = {
  parent: ParentMarketInput;
  children: ChildMarketInput[];
  multiCategoricalParent: boolean;
};

/** Display fields, before they become a `SessionMetadataDocument`. */
export type SessionMetadataInput = {
  title: string;
  description: string;
  itemName: string;
  itemNamePlural: string;
  heroImage: string;
  icon?: string;
  sections?: string[];
  children: Array<{
    outcomeIndex: number;
    displayName: string;
    color: string;
    sections?: string[];
  }>;
};

/**
 * What the orchestrator holds and persists for a session deploy. Grows as the
 * run proceeds: the metadata uri appears after upload, the addresses after
 * their transactions confirm.
 */
export type SessionDeploySnapshot = {
  deploy: SessionDeployInput;
  metadata: SessionMetadataInput;
  /** Set once the document is on IPFS and has been read back. */
  metadataUri?: string;
  /** The uris the document points at, kept so a resumed run can still link them. */
  images?: { hero: string; icon?: string };
  /** Set once the parent transaction confirms. */
  sessionId?: bigint;
  parentMarket?: Address;
  /** Child addresses in parent-outcome order, appended batch by batch. */
  childMarkets: Address[];
  /** Atomic when everything fits one transaction, phased otherwise. */
  mode: "atomic" | "phased";
  startedAt: number;
};

export type SessionDeployCtx = {
  chainId: number;
  factory: Address;
  /** Who deploys. Only this address may append child batches. */
  deployer: Address;
};

export type DeployedMarkets = {
  sessionId?: bigint;
  parentMarket?: Address;
  /** The transaction that opened the session, when whoever answered records one. */
  transactionHash?: string;
  /** In the order the events appeared, which is parent-outcome order. */
  childMarkets: Array<{ outcomeIndex: number; address: Address; transactionHash?: string }>;
};

export type SessionLookup = (args: {
  deployer: Address;
  /** The document this deploy uploaded. Unique to it, being a content hash. */
  metadataUri: string;
  /** Seconds. Ignores sessions older than the run, which a repeated draft has. */
  since: number;
}) => Promise<DeployedMarkets | null>;
