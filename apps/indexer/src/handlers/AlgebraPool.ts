import { indexer } from "envio";

import { abs } from "../utils/bigint";

import { predictionId, swapId } from "../utils/ids";
import { underlyingPerOutcome } from "../utils/poolPrice";
import { derivePrediction } from "../utils/prediction";

indexer.contractRegister({ contract: "AlgebraFactory", event: "Pool" }, async ({ event, context }) => {
  context.chain.AlgebraPool.add(event.params.pool);
});

/** An outcome token's row names its market and side; an underlying's names neither. */
const isOutcome = <T extends { childMarket_id?: string; outcomeIndex?: number }>(
  row: T | undefined,
): row is T & { childMarket_id: string; outcomeIndex: number } =>
  row?.childMarket_id !== undefined && row.outcomeIndex !== undefined;

indexer.onEvent({ contract: "AlgebraFactory", event: "Pool" }, async ({ event, context }) => {
  const [token0, token1] = [event.params.token0.toLowerCase(), event.params.token1.toLowerCase()];
  const [token0Row, token1Row] = await Promise.all([context.Token.get(token0), context.Token.get(token1)]);

  const outcome = isOutcome(token0Row) ? token0Row : isOutcome(token1Row) ? token1Row : undefined;
  const other = outcome === token0Row ? token1 : token0;
  const market = outcome === undefined ? undefined : await context.ChildMarket.get(outcome.childMarket_id);

  // the other side has to be this market's underlying, not the opposite outcome
  if (context.isPreload || outcome === undefined || market === undefined || market.underlyingToken !== other) {
    return;
  }

  context.Pool.set({
    id: event.params.pool.toLowerCase(),
    childMarket_id: outcome.childMarket_id,
    outcomeToken: outcome.id,
    underlyingToken: other,
    outcomeIndex: outcome.outcomeIndex,
    outcomeIsToken0: outcome.id === token0,
    price: 0n,
    tick: 0,
    underlyingPerOutcome: undefined,
    liquidity: 0n,
    volumeOutcome: 0n,
    volumeUnderlying: 0n,
    updatedAt: BigInt(event.block.timestamp),
  });
});

indexer.onEvent({ contract: "AlgebraPool", event: "Initialize" }, async ({ event, context }) => {
  const pool = await context.Pool.get(event.srcAddress.toLowerCase());

  if (context.isPreload || pool === undefined) {
    return;
  }

  context.Pool.set({
    ...pool,
    price: event.params.price,
    tick: Number(event.params.tick),
    underlyingPerOutcome: underlyingPerOutcome(event.params.price, pool.outcomeIsToken0),
  });
});

indexer.onEvent({ contract: "AlgebraPool", event: "Swap" }, async ({ event, context }) => {
  const poolId = event.srcAddress.toLowerCase();
  const recipient = event.params.recipient.toLowerCase();
  const pool = await context.Pool.get(poolId);

  const [executor, prediction, market] = await Promise.all([
    context.Executor.get(recipient),
    pool === undefined
      ? undefined
      : context.Prediction.get(predictionId(event.transaction.hash, recipient, pool.childMarket_id)),
    pool === undefined ? undefined : context.ChildMarket.get(pool.childMarket_id),
  ]);

  if (context.isPreload || pool === undefined) {
    return;
  }

  const [outcomeAmount, underlyingAmount] = pool.outcomeIsToken0
    ? [event.params.amount0, event.params.amount1]
    : [event.params.amount1, event.params.amount0];

  const after = underlyingPerOutcome(event.params.price, pool.outcomeIsToken0);

  context.Swap.set({
    id: swapId(event.transaction.hash, event.logIndex),
    pool_id: poolId,
    childMarket_id: pool.childMarket_id,
    executor_id: executor === undefined ? undefined : recipient,
    outcomeAmount,
    underlyingAmount,
    priceBefore: pool.price,
    priceAfter: event.params.price,
    tickBefore: pool.tick,
    tickAfter: Number(event.params.tick),
    underlyingPerOutcomeAfter: after,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    logIndex: event.logIndex,
    transactionHash: event.transaction.hash,
  });

  context.Pool.set({
    ...pool,
    price: event.params.price,
    tick: Number(event.params.tick),
    underlyingPerOutcome: after,
    liquidity: event.params.liquidity,
    volumeOutcome: pool.volumeOutcome + abs(outcomeAmount),
    volumeUnderlying: pool.volumeUnderlying + abs(underlyingAmount),
    updatedAt: BigInt(event.block.timestamp),
  });

  if (prediction === undefined || market === undefined) {
    return;
  }

  // amounts are signed from the pool's side, so the trader's are their mirror
  const isUp = pool.outcomeIndex === 1;
  const swapped = {
    upSwapUnderlying: prediction.upSwapUnderlying + (isUp ? -underlyingAmount : 0n),
    upSwapTokens: prediction.upSwapTokens + (isUp ? -outcomeAmount : 0n),
    downSwapUnderlying: prediction.downSwapUnderlying + (isUp ? 0n : -underlyingAmount),
    downSwapTokens: prediction.downSwapTokens + (isUp ? 0n : -outcomeAmount),
  };

  const before = underlyingPerOutcome(pool.price, pool.outcomeIsToken0);
  const around = isUp
    ? { upPriceBefore: prediction.upPriceBefore ?? before, upPriceAfter: after }
    : { downPriceBefore: prediction.downPriceBefore ?? before, downPriceAfter: after };

  context.Prediction.set({
    ...prediction,
    ...swapped,
    ...around,
    ...derivePrediction(swapped, market.lowerBound, market.upperBound),
  });
});
