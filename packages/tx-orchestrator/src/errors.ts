import type { TxErrorCause } from "./types";

/** Thrown for programmer error, a lifecycle call the run cannot honour. */
export class FlowStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlowStateError";
  }
}

type ErrorLike = {
  name?: unknown;
  code?: unknown;
  status?: unknown;
  message?: unknown;
  shortMessage?: unknown;
  details?: unknown;
  cause?: unknown;
};

function asErrorLike(value: unknown): ErrorLike | null {
  return typeof value === "object" && value !== null ? (value as ErrorLike) : null;
}

/** Walks the `cause` chain viem and wagmi wrap the original error in. */
function walkChain(error: unknown): ErrorLike[] {
  const out: ErrorLike[] = [];
  let current = asErrorLike(error);
  // Bounded
  for (let depth = 0; current && depth < 10; depth++) {
    out.push(current);
    current = asErrorLike(current.cause);
  }
  return out;
}

function textOf(error: ErrorLike): string {
  return [error.shortMessage, error.message, error.details]
    .filter((part): part is string => typeof part === "string")
    .join(" ")
    .toLowerCase();
}

const USER_REJECTED_NAMES = new Set(["UserRejectedRequestError", "UserRejectedRequestRpcError"]);

/** EIP-1193 4001, plus ethers' string code. */
function isRejectionCode(code: unknown): boolean {
  return code === 4001 || code === "ACTION_REJECTED";
}

const TRANSIENT_NAMES = new Set([
  "HttpRequestError",
  "TimeoutError",
  "RpcRequestError",
  "WaitForTransactionReceiptTimeoutError",
  "InternalRpcError",
  "LimitExceededRpcError",
]);

/**
 * The last resort, for a provider that has mangled both the code and the name.
 */
const REJECTION_TEXT = /user (rejected|denied|cancell?ed)|rejected by user|request rejected|signature denied/i;
const TRANSIENT_TEXT =
  /fetch failed|network error|timed out|timeout|econnreset|socket hang up|too many requests|rate limit|service unavailable|bad gateway/i;

/** JSON-RPC internal error and the HTTP statuses worth another poll. */
function isTransientCode(error: ErrorLike): boolean {
  return error.code === -32603 || error.status === 429 || error.status === 502 || error.status === 503;
}

/**
 * Classifies what a wallet or node threw.
 *
 * Order matters: a rejection often also reads as an internal RPC error once
 * a provider has wrapped it, so rejection is decided across the whole chain
 * before anything is called an RPC problem.
 */
export function classifyTxError(error: unknown): Extract<TxErrorCause, "rejected" | "rpc" | "unknown"> {
  const links = walkChain(error);

  for (const link of links) {
    if (isRejectionCode(link.code)) return "rejected";
    if (typeof link.name === "string" && USER_REJECTED_NAMES.has(link.name)) return "rejected";
  }
  const text = links.map(textOf).join(" ");
  if (REJECTION_TEXT.test(text)) return "rejected";

  for (const link of links) {
    if (typeof link.name === "string" && TRANSIENT_NAMES.has(link.name)) return "rpc";
    if (isTransientCode(link)) return "rpc";
  }
  if (TRANSIENT_TEXT.test(text)) return "rpc";

  // Anything unrecognised stops the run and asks, rather than retrying blind.
  return "unknown";
}

export function isFatalCause(cause: TxErrorCause): boolean {
  return cause === "reverted" || cause === "unknown";
}

export function isRetryableRead(cause: TxErrorCause): boolean {
  return cause === "rpc";
}

export function describeTxError(error: unknown): string {
  const links = walkChain(error);

  for (const link of links) {
    if (typeof link.shortMessage === "string" && link.shortMessage) return link.shortMessage;
  }
  for (const link of links) {
    if (typeof link.message === "string" && link.message) return firstLine(link.message);
  }
  if (typeof error === "string" && error) return firstLine(error);
  return "Unknown transaction error";
}

function firstLine(text: string): string {
  return text.split("\n")[0]?.trim() || text.trim();
}
