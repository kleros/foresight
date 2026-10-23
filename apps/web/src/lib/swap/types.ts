import type { Address, Hex } from "viem";

/**
 * Quoting a swap and getting calldata back, rather than a sent transaction — the trade executor
 * is the sender, so nothing here may reach for a wallet. The port lives beside its implementer so
 * that a feature can depend on it without a shared layer depending on a feature.
 */

export interface SwapQuoteRequest {
  tokenIn: Address;
  tokenOut: Address;
  /** Exactly what goes in. */
  amount: bigint;
  /** Holds `tokenIn` and receives `tokenOut`. */
  recipient: Address;
  /** Hundredths of a percent the quote may move against the recipient before it reverts. */
  slippageBps: number;
  /** The pool's sqrt price the swap stops at, leaving the rest of `amount` with the recipient. */
  limitSqrtPrice: bigint;
  /** What the swap spends if it runs all the way to the limit. */
  amountInAtLimit: bigint;
  /** What the swap returns if it stops at the limit, which caps the quoted output. */
  amountOutAtLimit: bigint;
  /** The pool's fee in millionths of the input, as read with its price. */
  poolFee: bigint;
  /** What the leg was shown to pay for this input; the swap may then pay no less than it, less `slippageBps`. */
  heldOut?: bigint;
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

/** The quoter answered that nothing takes this swap. Any other rejection means it gave no answer. */
export class NoSwapRouteError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "NoSwapRouteError";
  }
}

/** The quoter answered with a call for another swap than the one asked for, so its answer is not used. */
export class QuoteRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuoteRefusedError";
  }
}

export interface SwapQuoter {
  /** Rejects with `NoSwapRouteError` when no route takes the swap, and `QuoteRefusedError` for another swap's call. */
  quote(request: SwapQuoteRequest): Promise<SwapQuote>;
}

/** A swap of exactly `amount` with no price limit, whose calldata a caller re-encodes with its own minimum. */
export interface ExactInputRequest {
  tokenIn: Address;
  tokenOut: Address;
  amount: bigint;
  recipient: Address;
}

export interface ExactInputQuote {
  amountOut: bigint;
  /** The contract the calldata is for. */
  router: Address;
  /** Swapr's `exactInputSingle`; the quoter refuses any other route. */
  data: Hex;
}

export interface ExactInputQuoter {
  /** Rejects with `NoSwapRouteError` when no single-pool route takes the swap. */
  quote(request: ExactInputRequest): Promise<ExactInputQuote>;
}
