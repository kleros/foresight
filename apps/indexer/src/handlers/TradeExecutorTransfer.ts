import { indexer } from "envio";

import { positionId, predictionId, transferId } from "../utils/ids";
import { isAvailable } from "../utils/unavailable";

const blankPrediction = (
  event: { transaction: { hash: string }; block: { number: number; timestamp: number } },
  executor: string,
  childMarket: string,
) => ({
  id: predictionId(event.transaction.hash, executor, childMarket),
  executor_id: executor,
  childMarket_id: childMarket,
  transactionHash: event.transaction.hash,
  blockNumber: BigInt(event.block.number),
  timestamp: BigInt(event.block.timestamp),
  underlyingDelta: 0n,
  downDelta: 0n,
  upDelta: 0n,
  underlyingBalance: 0n,
  downBalance: 0n,
  upBalance: 0n,
  downSwapUnderlying: 0n,
  downSwapTokens: 0n,
  upSwapUnderlying: 0n,
  upSwapTokens: 0n,
  downAvgPrice: undefined,
  upAvgPrice: undefined,
  downPriceBefore: undefined,
  downPriceAfter: undefined,
  upPriceBefore: undefined,
  upPriceAfter: undefined,
  impliedPrediction: undefined,
});

indexer.onEvent(
  {
    contract: "TradeExecutor",
    event: "Transfer",
    wildcard: true,
    where: ({ chain }) => {
      const executors = chain.TradeExecutor.addresses;

      return { params: [{ from: executors }, { to: executors }] };
    },
  },
  async ({ event, context }) => {
    const { value } = event.params;
    const [from, to] = [event.params.from.toLowerCase(), event.params.to.toLowerCase()];
    if (from === to || value === 0n) {
      return;
    }

    const token = event.srcAddress.toLowerCase();
    const hash = event.transaction.hash;
    const [sender, recipient, knownToken] = await Promise.all([
      context.Executor.get(from),
      context.Executor.get(to),
      context.Token.get(token),
    ]);

    // An outcome token names its market. An underlying is shared by every child priced against
    // it, so its movement in this transaction is summed off the Transfer rows and joins whichever
    // of those markets the transaction also trades, whichever leg the log lists first.
    const market =
      knownToken?.childMarket_id === undefined ? undefined : await context.ChildMarket.get(knownToken.childMarket_id);
    const conditionalMarkets =
      knownToken !== undefined && knownToken.childMarket_id === undefined
        ? await context.ChildMarket.getWhere({ underlyingToken: { _eq: token } })
        : [];

    // The transfer seen from each executor involved: negative leaving the sender, positive
    // entering the recipient. Both at once only when one executor pays another directly.
    const sides = [
      ...(sender ? [{ executor: from, amount: -value, counterparty: to }] : []),
      ...(recipient ? [{ executor: to, amount: value, counterparty: from }] : []),
    ];

    const loadedSides = await Promise.all(
      sides.map(async (side) => {
        const moved = await context.Position.get(positionId(side.executor, token));

        if (market !== undefined) {
          const [previous, legs, pools, down, up, underlying] = await Promise.all([
            context.Prediction.get(predictionId(hash, side.executor, market.id)),
            context.Transfer.getWhere({ transactionHash: { _eq: hash }, token: { _eq: market.underlyingToken } }),
            context.Pool.getWhere({ childMarket_id: { _eq: market.id } }),
            ...[market.downToken, market.upToken, market.underlyingToken].map((held) =>
              isAvailable(held) ? context.Position.get(positionId(side.executor, held)) : undefined,
            ),
          ]);

          const leg = legs
            .filter((row) => row.executor_id === side.executor)
            .reduce((sum, row) => sum + row.amount, 0n);

          return { ...side, kind: "outcome" as const, moved, market, previous, leg, pools, down, up, underlying };
        }

        const [legs, predictions] = await Promise.all([
          context.Transfer.getWhere({ transactionHash: { _eq: hash }, token: { _eq: token } }),
          Promise.all(
            conditionalMarkets.map((candidate) =>
              context.Prediction.get(predictionId(hash, side.executor, candidate.id)),
            ),
          ),
        ]);

        const leg = legs.filter((row) => row.executor_id === side.executor).reduce((sum, row) => sum + row.amount, 0n);

        return { ...side, kind: "underlying" as const, moved, leg, predictions };
      }),
    );

    if (context.isPreload) {
      return;
    }

    for (const loaded of loadedSides) {
      const { executor, amount, counterparty, moved } = loaded;
      const balance = (moved?.balance ?? 0n) + amount;

      context.Position.set({
        id: positionId(executor, token),
        executor_id: executor,
        token,
        balance,
        updatedAt: BigInt(event.block.timestamp),
      });

      context.Transfer.set({
        id: transferId(hash, event.logIndex, executor),
        executor_id: executor,
        token,
        amount,
        counterparty,
        blockNumber: BigInt(event.block.number),
        timestamp: BigInt(event.block.timestamp),
        transactionHash: hash,
      });

      if (loaded.kind === "outcome") {
        const { market, previous, leg, pools, down, up, underlying } = loaded;
        const base = previous ?? blankPrediction(event, executor, market.id);
        const spot = (outcomeIndex: number) =>
          pools.find((pool) => pool.outcomeIndex === outcomeIndex)?.underlyingPerOutcome;
        const [downSpot, upSpot] = [spot(0), spot(1)];

        // a transfer precedes the Swap log of its own swap, so the pool still reads its price before that swap
        context.Prediction.set({
          ...base,
          underlyingDelta: leg,
          downDelta: base.downDelta + (knownToken?.outcomeIndex === 0 ? amount : 0n),
          upDelta: base.upDelta + (knownToken?.outcomeIndex === 1 ? amount : 0n),
          underlyingBalance: underlying?.balance ?? 0n,
          downBalance: market.downToken === token ? balance : (down?.balance ?? 0n),
          upBalance: market.upToken === token ? balance : (up?.balance ?? 0n),
          downPriceBefore: base.downPriceBefore ?? downSpot,
          downPriceAfter: downSpot ?? base.downPriceAfter,
          upPriceBefore: base.upPriceBefore ?? upSpot,
          upPriceAfter: upSpot ?? base.upPriceAfter,
        });
        continue;
      }

      if (conditionalMarkets.length === 0) {
        continue;
      }

      const total = loaded.leg + amount;

      // only a market this transaction already traded takes the leg; a bare underlying move is not a prediction
      for (const prediction of loaded.predictions) {
        if (prediction === undefined) continue;
        context.Prediction.set({ ...prediction, underlyingDelta: total, underlyingBalance: balance });
      }
    }
  },
);
