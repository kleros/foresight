/** Every message along the `cause` chain viem and wagmi wrap a node's error in, lower-cased. */
export function chainText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; typeof current === "object" && current !== null && depth < 10; depth++) {
    const link = current as {
      message?: unknown;
      shortMessage?: unknown;
      details?: unknown;
      data?: unknown;
      cause?: unknown;
    };
    // an injected wallet's JSON-RPC error carries the node's reason only in `data`
    const data =
      typeof link.data === "object" && link.data !== null ? (link.data as { message?: unknown }).message : link.data;
    for (const part of [link.shortMessage, link.message, link.details, data])
      if (typeof part === "string") parts.push(part);
    current = link.cause;
  }
  return parts.join(" ").toLowerCase();
}

// a node reports both as an internal JSON-RPC error, which `classifyTxError` reads as a slow network
export const OUT_OF_FUNDS = /insufficient funds|doesn't have enough funds/;
export const REVERTS = /execution reverted|reverted with|vm exception/;
