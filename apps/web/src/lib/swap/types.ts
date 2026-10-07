import type { Address, Hex } from "viem";

/**
 * Quoting a swap and getting calldata back, rather than a sent transaction — the trade executor
 * is the sender, so nothing here may reach for a wallet. The port lives beside its implementer so
 * that a feature can depend on it without a shared layer depending on a feature.
 */

export interface SwapQuoteRequest {
  tokenIn: Address;
  tokenOut: Address;
  /** Exactly what goes in, or exactly what must come out when `exactOut` is set. */
  amount: bigint;
  /** Holds `tokenIn` and receives `tokenOut`. */
  recipient: Address;
  exactOut?: boolean;
  /** Hundredths of a percent the quote may move against the recipient before it reverts. */
  slippageBps?: number;
}

export interface SwapQuote {
  amountIn: bigint;
  amountOut: bigint;
  /** The contract to call, and the spender to approve for `amountIn`. */
  router: Address;
  data: Hex;
  /** Native currency the call carries; zero for a swap between two ERC-20s. */
  value: bigint;
}

export interface SwapQuoter {
  quote(request: SwapQuoteRequest): Promise<SwapQuote>;
}
