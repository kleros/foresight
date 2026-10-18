import { InsufficientLiquidityError, Lens, SwapRevertsError, type ChainId } from "@seer-pm/lens/client";
import {
  BaseError,
  ContractFunctionRevertedError,
  decodeFunctionData,
  encodeFunctionData,
  toFunctionSelector,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import { ALGEBRA_ROUTER_ABI } from "./algebraRouter";
import { NoSwapRouteError, type ExactInputQuoter, type SwapQuoter } from "./types";

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

// Lens leaves the limit at zero.
const EXACT_INPUT_SINGLE = toFunctionSelector(ALGEBRA_ROUTER_ABI[0]);

const Q192 = 2n ** 192n;

/** LensQuoter's reverts that answer the request rather than fail it. */
const NO_ROUTE_ERRORS = new Set(["NoRoute", "ZeroAmount", "UnsupportedAMM"]);

/** Whether Lens answered that no route takes the swap, as opposed to giving no answer. */
function answeredNoRoute(error: unknown): boolean {
  // Lens throws InsufficientLiquidityError, with no cause, for any failure of its gas-capped
  // simulation, so a transport failure on that one call still reads as no route.
  if (error instanceof InsufficientLiquidityError || error instanceof SwapRevertsError) return true;
  const reverted =
    error instanceof BaseError ? error.walk((link) => link instanceof ContractFunctionRevertedError) : null;
  return reverted instanceof ContractFunctionRevertedError && NO_ROUTE_ERRORS.has(reverted.data?.errorName ?? "");
}

/**
 * What `amountIn` returns at no worse than the limit price, before the pool fee, less `slippageBps`.
 * Algebra's token0 is the lower address, and the squared sqrt price is token1 per token0.
 */
function minOutAtLimit(
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint,
  limitSqrtPrice: bigint,
  slippageBps: number,
) {
  const priceX192 = limitSqrtPrice * limitSqrtPrice;
  const kept = 10_000n - BigInt(slippageBps);
  return BigInt(tokenIn) < BigInt(tokenOut)
    ? (amountIn * priceX192 * kept) / (Q192 * 10_000n)
    : (amountIn * Q192 * kept) / (priceX192 * 10_000n);
}

/** The latest block's time, in seconds: what the router checks a deadline against, whatever the visitor's clock says. */
const latestBlockTime = (client: PublicClient) => async () => (await client.getBlock({ blockTag: "latest" })).timestamp;

export function createLensQuoter(
  client: PublicClient,
  chainId: ChainId,
  chainNow: () => Promise<bigint> = latestBlockTime(client),
): SwapQuoter {
  const lens = new Lens(client, chainId);

  return {
    async quote(request) {
      const deadline = (await chainNow()) + QUOTE_DEADLINE_SECONDS;
      const result = await lens
        .quote({
          tokenIn: request.tokenIn,
          tokenOut: request.tokenOut,
          amount: request.amount,
          recipient: request.recipient,
          slippageBps: request.slippageBps,
          deadline,
        })
        .catch((error: unknown) => {
          if (!answeredNoRoute(error)) throw error;
          throw new NoSwapRouteError(`Lens found no route from ${request.tokenIn} to ${request.tokenOut}.`, {
            cause: error,
          });
        });

      if (!result.data.startsWith(EXACT_INPUT_SINGLE)) {
        throw new NoSwapRouteError(
          `Lens routed ${request.tokenIn} to ${request.tokenOut} through a call that takes no price limit.`,
        );
      }
      const [params] = decodeFunctionData({ abi: ALGEBRA_ROUTER_ABI, data: result.data as Hex }).args;

      // Lens quotes the whole amount past the target; the limit stops it at `amountOutAtLimit`
      const amountOut = result.amountOut < request.amountOutAtLimit ? result.amountOut : request.amountOutAtLimit;
      const scaled = result.amountOut === 0n ? 0n : (params.amountOutMinimum * amountOut) / result.amountOut;
      const swapped = params.amountIn < request.amountInAtLimit ? params.amountIn : request.amountInAtLimit;
      const floor = minOutAtLimit(
        params.tokenIn,
        params.tokenOut,
        swapped,
        request.limitSqrtPrice,
        request.slippageBps,
      );
      const amountOutMinimum = scaled > floor ? scaled : floor;

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

/** Lens' route for an exact-input swap with no price limit, held to Swapr's single-pool call. */
export function createLensExactInputQuoter(
  client: PublicClient,
  chainId: ChainId,
  chainNow: () => Promise<bigint> = latestBlockTime(client),
): ExactInputQuoter {
  const lens = new Lens(client, chainId);

  return {
    async quote(request) {
      const deadline = (await chainNow()) + QUOTE_DEADLINE_SECONDS;
      const result = await lens.quote({ ...request, slippageBps: 0, deadline }).catch((error: unknown) => {
        if (!answeredNoRoute(error)) throw error;
        throw new NoSwapRouteError(`Lens found no route from ${request.tokenIn} to ${request.tokenOut}.`, {
          cause: error,
        });
      });
      if (!result.data.startsWith(EXACT_INPUT_SINGLE)) {
        throw new NoSwapRouteError(`Lens routed ${request.tokenIn} to ${request.tokenOut} through more than one pool.`);
      }
      return { amountOut: result.amountOut, router: result.target as Address, data: result.data as Hex };
    },
  };
}
