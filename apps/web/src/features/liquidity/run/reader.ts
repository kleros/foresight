import { parseAbi, type PublicClient } from "viem";

import { nonceCounts, readSentWithNonce } from "./sentWithNonce";
import { fetchPoolState } from "../api/getLiquidityPools";
import { LIQUIDITY_ALLOW_LIST } from "../oracle/allowlist";
import type { LiquidityReader } from "../types";

const OWNER_OF_ABI = parseAbi(["function ownerOf(uint256 tokenId) view returns (address)"]);

/** The chain reads a liquidity run makes, through `client`. */
export function createLiquidityReader(client: PublicClient, chainId: number): LiquidityReader {
  const list = LIQUIDITY_ALLOW_LIST[chainId];
  if (!list) throw new Error(`No liquidity allow list for chain ${chainId}.`);
  return {
    chainTime: async () => (await client.getBlock({ blockTag: "latest" })).timestamp,
    pool: (tokenA, tokenB) => fetchPoolState(client, chainId, tokenA, tokenB),
    ownerOf: (tokenId) =>
      client.readContract({
        address: list.positionManager,
        abi: OWNER_OF_ABI,
        functionName: "ownerOf",
        args: [tokenId],
      }),
    nextNonce: (account) => client.getTransactionCount({ address: account, blockTag: "latest" }),
    async hasPending(account) {
      const [mined, pending] = await nonceCounts(client, account);
      return pending > mined;
    },
    blockNumber: () => client.getBlockNumber({ cacheTime: 0 }),
    sentWithNonce: (args) => readSentWithNonce(client, args),
  };
}
