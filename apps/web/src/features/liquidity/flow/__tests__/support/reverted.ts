import type { Hash, PublicClient } from "viem";

/** Hardhat mines a send that reverts and answers it with an RPC error whose `data.txHash` names the mined send. */
export function minedHash(error: unknown): Hash | undefined {
  for (let at = error; typeof at === "object" && at !== null; at = (at as { cause?: unknown }).cause) {
    const data = (at as { data?: unknown }).data;
    const hash = typeof data === "object" && data !== null ? (data as { txHash?: unknown }).txHash : undefined;
    if (typeof hash === "string") return hash as Hash;
  }
  return undefined;
}

/** Whether a send mined and the contract reverted it; a send that never reached the chain throws. */
export async function revertedOnChain(
  client: Pick<PublicClient, "getTransactionReceipt">,
  index: number,
  record: { hash?: Hash; error?: unknown } | undefined,
) {
  if (!record) throw new Error(`no send ${index}`);
  if (!record.hash) throw new Error(`send ${index} never reached the chain: ${String(record.error).slice(0, 600)}`);
  return (await client.getTransactionReceipt({ hash: record.hash })).status === "reverted";
}
