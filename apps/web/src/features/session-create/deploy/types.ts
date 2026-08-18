export type DeployStage =
  /** Nothing started. */
  | "idle"
  /** Images + metadata document to IPFS via Atlas: one signature. */
  | "uploading"
  /** Reading the document back and parsing it, before any gas. */
  | "verifying"
  /** Awaiting the deploy signature in the wallet. */
  | "signing"
  /** Signed and out there: in the mempool, then accruing blocks. */
  | "confirming"
  /** Stopped short: rejected, cancelled, reverted or asked to stop. */
  | "halted"
  /** On-chain done; the subgraph is catching up. */
  | "indexing"
  | "complete";

export type MarketDeployState = "pending" | "running" | "success" | "error";

export type MarketProgress = {
  state: MarketDeployState;
  hash?: string;
};

export type DeployFailure = {
  message: string;
  retryable: boolean;
  hash?: string;
};

/** An unfinished run found in storage, already reconciled against the chain. */
export type DeployResume = {
  stepId: string;
  label: string;
  outcome: "none" | "unknown" | "pending" | "confirmed" | "reverted" | "dropped";
  /** False means continuing may pay for work already on chain. */
  canSelfCheck: boolean;
  hash?: string;
};

export type SessionDeployProgress = {
  stage: DeployStage;
  mode: "atomic" | "phased";
  /** The batch being signed, 1-based. Always 1 in atomic mode. */
  batch: number;
  batches: number;
  parent: MarketProgress;
  /** One entry per outcome, in outcome order. Child order is permanent. */
  children: MarketProgress[];
  /** One entry per phased batch, in batch order. Empty in atomic mode. */
  batchSteps: MarketProgress[];
  failure?: DeployFailure;
  resume?: DeployResume;
  /** Set once the metadata document is on IPFS and has been read back. */
  metadataUri?: string;
  /** Where the images went, once they are up. */
  images?: { hero?: string; icon?: string };
  parentMarket?: string;
};

export type SessionDeployDriver = {
  start(): void;
  /** Call on mount, before offering the deploy button. */
  recover(): void;
  continueRecovered(): void;
  /** Signs the stopped step again, after a rejection or a failure. */
  retry(): void;
  /**
   * Throws the run away and returns the screen to idle. Anything already on
   * chain stays there: this forgets the run, it does not undo it.
   */
  reset(): void;
  /**
   * Lets go of the run without discarding it, for a driver being replaced.
   * Without it the old one keeps driving, and two drivers writing one storage
   * key is two wallets prompting for the same session.
   */
  dispose(): void;
  getProgress(): SessionDeployProgress;
  subscribe(listener: () => void): () => void;
};
