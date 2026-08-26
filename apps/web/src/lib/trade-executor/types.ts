import type { Address, PublicClient } from "viem";

/** The slice of a viem client the executor reads use; tests fake this, not the network. */
export type ExecutorReadClient = Pick<PublicClient, "readContract">;

export type FundsReadClient = Pick<PublicClient, "readContract" | "getBalance">;

/** An amount of the chain's native currency, or of an ERC-20. */
export type Asset = { token: Address | "native"; amount: bigint };

export type ExecutorState = {
  /** CREATE2 address the owner's executor deploys to. */
  predicted: Address;
  /** Null until `createExecutor` has run for this owner. */
  deployed: Address | null;
};
