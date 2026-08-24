import { WAD } from "./bigint";

const Q192 = 2n ** 192n;

/** Underlying per whole outcome token at an Algebra sqrt price, scaled by 1e18. */
export const underlyingPerOutcome = (sqrtPriceX96: bigint, outcomeIsToken0: boolean): bigint | undefined => {
  if (sqrtPriceX96 === 0n) return undefined;

  const ratio = sqrtPriceX96 * sqrtPriceX96;

  return outcomeIsToken0 ? (ratio * WAD) / Q192 : (Q192 * WAD) / ratio;
};
