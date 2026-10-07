import { Lens, type ChainId } from "@seer-pm/lens/client";
import type { Address, Hex, PublicClient } from "viem";

import type { SwapQuoter } from "./types";

/**
 * Seer's on-chain LensQuoter picks the route and returns the router call to make. It simulates
 * against a gas cap first, so a pool thin enough to quote but not to execute throws rather than
 * reverting later from inside a batch.
 */
/**
 * Seconds. The SDK's own default is five minutes from the moment each leg is quoted, and a batch
 * of ten options is quoted leg by leg before the wallet even opens, so the first leg's clock
 * would run out while someone confirms on a hardware wallet.
 */
const QUOTE_DEADLINE_SECONDS = 30n * 60n;

export function createLensQuoter(client: PublicClient, chainId: ChainId, now: () => number = Date.now): SwapQuoter {
  const lens = new Lens(client, chainId);

  return {
    async quote(request) {
      const result = await lens.quote({
        tokenIn: request.tokenIn,
        tokenOut: request.tokenOut,
        amount: request.amount,
        recipient: request.recipient,
        exactOut: request.exactOut,
        slippageBps: request.slippageBps,
        deadline: BigInt(Math.floor(now() / 1000)) + QUOTE_DEADLINE_SECONDS,
      });

      return {
        amountIn: result.amountIn,
        amountOut: result.amountOut,
        router: result.target as Address,
        data: result.data as Hex,
        value: result.msgValue,
      };
    },
  };
}
