import { indexer } from "envio";

indexer.onEvent({ contract: "ConditionalTokens", event: "ConditionResolution" }, async ({ event, context }) => {
  const conditionId = event.params.conditionId.toLowerCase();
  // every market of every session asking this question, none for a condition outside Foresight
  const markets = await context.MarketCondition.getWhere({ conditionId: { _eq: conditionId } });

  context.ResolvedCondition.set({ id: conditionId, payoutNumerators: event.params.payoutNumerators });
  for (const market of markets) {
    context.MarketCondition.set({ ...market, payoutNumerators: event.params.payoutNumerators });
  }
});
