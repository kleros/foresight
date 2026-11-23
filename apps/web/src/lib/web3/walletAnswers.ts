import type { FlowTx } from "@foresight/tx-orchestrator";
import { isAddressEqual, type Address, type Hex } from "viem";

/** EIP-5792's error for a batch id the wallet does not know. */
export const UNKNOWN_BUNDLE = 5730;

export const errorCode = (error: unknown) =>
  typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;

/**
 * Wallet answers to a send request that leave no prompt open and nothing signed: EIP-1193 unauthorized and
 * unsupported method, JSON-RPC method not found and invalid params, EIP-1474 execution reverted, and EIP-5792's
 * refusals that create no bundle (5700, 5710, 5740, 5750, 5760). Not a disconnect (4900, 4901), after which the
 * wallet may have signed, nor 5720, a duplicate id the wallet already holds.
 */
export const NO_PROMPT_CODES: ReadonlySet<unknown> = new Set([
  4100, 4200, -32601, -32602, 3, 5700, 5710, 5740, 5750, 5760,
]);

/** WalletConnect's USER_REJECTED, the code its relay answers a declined request with. */
const WALLETCONNECT_USER_REJECTED = 5000;

function inChain(error: unknown, test: (link: unknown) => boolean): boolean {
  for (let link = error, depth = 0; link && depth < 8; depth += 1) {
    if (test(link)) return true;
    link = typeof link === "object" ? (link as { cause?: unknown }).cause : undefined;
  }
  return false;
}

export const walletConnectRejection = (error: unknown) =>
  inChain(error, (link) => errorCode(link) === WALLETCONNECT_USER_REJECTED);

export const answeredWithoutPrompt = (error: unknown) => inChain(error, (link) => NO_PROMPT_CODES.has(errorCode(link)));

/** Whether a mined call is `tx`, by target, calldata and native value. */
export const sameCall = (mined: { to: Address; input: Hex; value: bigint }, tx: FlowTx) =>
  isAddressEqual(mined.to, tx.to) && mined.input === (tx.data ?? "0x") && mined.value === (tx.value ?? 0n);

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });
