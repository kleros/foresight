import { indexer } from "envio";

import { noteRedemption } from "../utils/redeem";
import { SEER_ROUTERS } from "../utils/routers";

indexer.onEvent({ contract: "ConditionalTokens", event: "ConditionResolution" }, async ({ event, context }) => {
  const conditionId = event.params.conditionId.toLowerCase();
  // every market of every session asking this question, none for a condition outside Foresight
  const markets = await context.MarketCondition.getWhere({ conditionId: { _eq: conditionId } });

  context.ResolvedCondition.set({ id: conditionId, payoutNumerators: event.params.payoutNumerators });
  for (const market of markets) {
    context.MarketCondition.set({ ...market, payoutNumerators: event.params.payoutNumerators });
  }
});

// Seer's routers send no collateral for a redeem that pays nothing, so this event is the only answer to its pulls.
indexer.onEvent(
  {
    contract: "ConditionalTokens",
    event: "PayoutRedemption",
    where: { params: [{ redeemer: [...SEER_ROUTERS] }] },
  },
  async ({ event, context }) => {
    if (event.params.payout !== 0n || context.isPreload) return;
    await noteRedemption(context, {
      router: event.params.redeemer.toLowerCase(),
      collateral: event.params.collateralToken.toLowerCase(),
      hash: event.transaction.hash,
      logIndex: event.logIndex,
      block: event.block,
    });
  },
);
