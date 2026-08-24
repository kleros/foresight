import { abs, WAD } from "./bigint";

/**
 * Underlying per whole token: buying 100 UP for 40 arrives as (-40, +100) and prices at 0.4.
 * Zero or same-sign totals mean the swaps cancelled into neither a buy nor a sell: no price.
 */
const priceOf = (underlying: bigint, tokens: bigint) =>
  underlying === 0n || tokens === 0n || underlying > 0n === tokens > 0n
    ? undefined
    : (abs(underlying) * WAD) / abs(tokens);

type Swapped = {
  downSwapUnderlying: bigint;
  downSwapTokens: bigint;
  upSwapUnderlying: bigint;
  upSwapTokens: bigint;
};

/**
 * The UP price is the forecast normalised onto the market's scale and DOWN is its mirror, so
 * either side alone gives a forecast; a market trading in balance gives the same one twice.
 */
export const derivePrediction = (swapped: Swapped, lowerBound: bigint, upperBound: bigint) => {
  const upAvgPrice = priceOf(swapped.upSwapUnderlying, swapped.upSwapTokens);
  const downAvgPrice = priceOf(swapped.downSwapUnderlying, swapped.downSwapTokens);
  const span = upperBound - lowerBound;

  const impliedPrediction =
    upAvgPrice !== undefined
      ? lowerBound + (upAvgPrice * span) / WAD
      : downAvgPrice !== undefined
        ? upperBound - (downAvgPrice * span) / WAD
        : undefined;

  return { upAvgPrice, downAvgPrice, impliedPrediction };
};
