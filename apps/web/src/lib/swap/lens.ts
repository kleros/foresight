import { Lens, type ChainId } from "@seer-pm/lens/client";
import {
  decodeFunctionData,
  encodeFunctionData,
  parseAbi,
  toFunctionSelector,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

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

/** Swapr's Algebra router, which Lens returns for a single-pool route. Lens leaves the limit at zero. */
const ALGEBRA_ROUTER_ABI = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 limitSqrtPrice) params) payable returns (uint256 amountOut)",
]);
const EXACT_INPUT_SINGLE = toFunctionSelector(ALGEBRA_ROUTER_ABI[0]);

export function createLensQuoter(client: PublicClient, chainId: ChainId, now: () => number = Date.now): SwapQuoter {
  const lens = new Lens(client, chainId);

  return {
    async quote(request) {
      const result = await lens.quote({
        tokenIn: request.tokenIn,
        tokenOut: request.tokenOut,
        amount: request.amount,
        recipient: request.recipient,
        slippageBps: request.slippageBps,
        deadline: BigInt(Math.floor(now() / 1000)) + QUOTE_DEADLINE_SECONDS,
      });

      if (!result.data.startsWith(EXACT_INPUT_SINGLE)) {
        throw new Error(
          `Lens routed ${request.tokenIn} to ${request.tokenOut} through a call that takes no price limit.`,
        );
      }
      const [params] = decodeFunctionData({ abi: ALGEBRA_ROUTER_ABI, data: result.data as Hex }).args;

      // Lens quotes the whole amount past the target; the limit stops it at `amountOutAtLimit`
      const amountOut = result.amountOut < request.amountOutAtLimit ? result.amountOut : request.amountOutAtLimit;
      const amountOutMinimum = result.amountOut === 0n ? 0n : (params.amountOutMinimum * amountOut) / result.amountOut;

      return {
        amountIn: result.amountIn,
        amountOut,
        router: result.target as Address,
        data: encodeFunctionData({
          abi: ALGEBRA_ROUTER_ABI,
          functionName: "exactInputSingle",
          args: [{ ...params, amountOutMinimum, limitSqrtPrice: request.limitSqrtPrice }],
        }),
        value: result.msgValue,
      };
    },
  };
}
