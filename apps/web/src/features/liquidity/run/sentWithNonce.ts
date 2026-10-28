import { isAddressEqual, type Address, type PublicClient } from "viem";

import type { SentWithNonce } from "../types";

/** `owner`'s mined and broadcast transaction counts. */
export const nonceCounts = (client: PublicClient, owner: Address) =>
  Promise.all([
    client.getTransactionCount({ address: owner, blockTag: "latest" }),
    client.getTransactionCount({ address: owner, blockTag: "pending" }),
  ]);

/** What took `owner`'s `nonce`, looked for from block `fromBlock` on (LiquidityReader.sentWithNonce). */
export async function readSentWithNonce(
  client: PublicClient,
  { owner, nonce, fromBlock }: { owner: Address; nonce: number; fromBlock: bigint },
): Promise<SentWithNonce> {
  const [mined, pending] = await nonceCounts(client, owner);
  if (mined <= nonce) return { status: pending > nonce ? "pending" : "none" };

  const sentIn = async (blockNumber: bigint) =>
    (await client.getBlock({ blockNumber, includeTransactions: true })).transactions.find(
      (each) => isAddressEqual(each.from, owner) && each.nonce === nonce,
    );
  const countAfter = (blockNumber: bigint) => client.getTransactionCount({ address: owner, blockNumber });

  /** The first block after which the count passes `nonce`; null where it passed before `fromBlock`. A pruned node rejects. */
  async function blockMining(head: bigint) {
    if (fromBlock > 0n && (await countAfter(fromBlock - 1n)) > nonce) return null;
    let [low, high] = [fromBlock, head];
    while (low < high) {
      const middle = (low + high) / 2n;
      if ((await countAfter(middle)) > nonce) high = middle;
      else low = middle + 1n;
    }
    return low;
  }

  /** The block-by-block search from `head` down, for a node that keeps no past state. */
  async function walkedTo(head: bigint) {
    for (let number = head; number >= fromBlock; number--) {
      const tx = await sentIn(number);
      if (tx) return tx;
    }
    return undefined;
  }

  const head = await client.getBlockNumber({ cacheTime: 0 });
  const minedIn = await blockMining(head).catch(() => undefined);
  if (minedIn === null) return { status: "taken" };
  const tx = minedIn === undefined ? await walkedTo(head) : await sentIn(minedIn);
  if (!tx?.to) return { status: "taken" };
  return { status: "mined", hash: tx.hash, to: tx.to, input: tx.input, value: tx.value };
}
