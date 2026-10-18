import { parseAbi } from "viem";

/** Swapr's Algebra router call that Lens returns for a single-pool route, with its limit left at zero. */
export const ALGEBRA_ROUTER_ABI = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 limitSqrtPrice) params) payable returns (uint256 amountOut)",
]);
