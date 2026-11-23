import type { BalanceTxGateway, FlowRunStore } from "@foresight/tx-orchestrator";
import type { Address, Hash, Hex } from "viem";

import type { WalletRedeemInput } from "./plan";

export interface RedeemProgress {
  stage: "idle" | "signing" | "confirming" | "review" | "halted" | "complete";
  failure?: { reason: string; retryable: boolean };
}

export type SentWithNonce =
  | { status: "mined"; hash: Hash; to: Address; input: Hex; value: bigint }
  | { status: "pending" }
  | { status: "none" }
  | { status: "taken" };

export interface RedeemReader {
  nextNonce(account: Address): Promise<number>;
  hasPending(account: Address): Promise<boolean>;
  blockNumber(): Promise<bigint>;
  sentWithNonce(args: { owner: Address; nonce: number; fromBlock: bigint }): Promise<SentWithNonce>;
  balanceOf(token: Address, account: Address): Promise<bigint>;
}

/** EIP-1193: the connected wallet's provider. */
export interface RedeemWallet {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
}

export interface RedeemRun {
  start(): void;
  recover(): void;
  resume(): void;
  retry(): void;
  dispose(): void;
  getProgress(): RedeemProgress;
  subscribe(listener: () => void): () => void;
}

export function createRedeemRun(_args: {
  gateway: BalanceTxGateway;
  wallet: RedeemWallet;
  reader: RedeemReader;
  store: FlowRunStore;
  flowId: string;
  account: () => Address | undefined;
  chainId: () => number;
  request: () => WalletRedeemInput;
  now?: () => number;
  pollMs?: number;
}): RedeemRun {
  throw new Error("not implemented");
}
