import { indexer } from "envio";

import { positionId, predictionId, transferId } from "../utils/ids";
import { isAvailable } from "../utils/unavailable";

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
    const [sender, recipient, knownToken] = await Promise.all([
      context.Executor.get(from),
      context.Executor.get(to),
      context.Token.get(token),
    ]);

    const market = knownToken === undefined ? undefined : await context.ChildMarket.get(knownToken.childMarket_id);

    // The transfer seen from each executor involved: negative leaving the sender, positive
    // entering the recipient. Both at once only when one executor pays another directly.
    const sides = [
      ...(sender ? [{ executor: from, amount: -value, counterparty: to }] : []),
      ...(recipient ? [{ executor: to, amount: value, counterparty: from }] : []),
    ];

    const loadedSides = await Promise.all(
      sides.map(async (side) => {
        const [previous, moved, down, up, underlying] = await Promise.all([
          knownToken === undefined
            ? undefined
            : context.Prediction.get(predictionId(event.transaction.hash, side.executor, knownToken.childMarket_id)),
          context.Position.get(positionId(side.executor, token)),
          ...[market?.downToken, market?.upToken, market?.underlyingToken].map((held) =>
            isAvailable(held) ? context.Position.get(positionId(side.executor, held)) : undefined,
          ),
        ]);

        return { ...side, previous, moved, down, up, underlying };
      }),
    );

    if (context.isPreload) {
      return;
    }

    for (const { executor, amount, counterparty, previous, moved, down, up, underlying } of loadedSides) {
      const balance = (moved?.balance ?? 0n) + amount;

      context.Position.set({
        id: positionId(executor, token),
        executor_id: executor,
        token,
        balance,
        updatedAt: BigInt(event.block.timestamp),
      });

      context.Transfer.set({
        id: transferId(event.transaction.hash, event.logIndex, executor),
        executor_id: executor,
        token,
        amount,
        counterparty,
        blockNumber: BigInt(event.block.number),
        timestamp: BigInt(event.block.timestamp),
        transactionHash: event.transaction.hash,
      });

      if (knownToken === undefined || market === undefined) {
        continue;
      }

      const base = previous ?? {
        id: predictionId(event.transaction.hash, executor, knownToken.childMarket_id),
        executor_id: executor,
        childMarket_id: knownToken.childMarket_id,
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
      };

      context.Prediction.set({
        ...base,
        underlyingDelta: base.underlyingDelta + (knownToken.outcomeIndex === undefined ? amount : 0n),
        downDelta: base.downDelta + (knownToken.outcomeIndex === 0 ? amount : 0n),
        upDelta: base.upDelta + (knownToken.outcomeIndex === 1 ? amount : 0n),
        underlyingBalance: market.underlyingToken === token ? balance : (underlying?.balance ?? 0n),
        downBalance: market.downToken === token ? balance : (down?.balance ?? 0n),
        upBalance: market.upToken === token ? balance : (up?.balance ?? 0n),
      });
    }
  },
);
