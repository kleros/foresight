import { erc20Abi, type PublicClient } from "viem";

import { nonceCounts, readSentWithNonce } from "@/lib/web3/sentWithNonce";

import type { RedeemReader } from "./run";

/** The chain reads a wallet redeem run makes, through `client`. */
export function createRedeemReader(client: PublicClient): RedeemReader {
  return {
    nextNonce: (account) => client.getTransactionCount({ address: account, blockTag: "latest" }),
    async hasPending(account) {
      const [mined, pending] = await nonceCounts(client, account);
      return pending > mined;
    },
    blockNumber: () => client.getBlockNumber({ cacheTime: 0 }),
    sentWithNonce: (args) => readSentWithNonce(client, args),
    balanceOf: (token, account) =>
      client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
  };
}
