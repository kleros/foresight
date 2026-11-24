import { indexer } from "envio";

indexer.onEvent({ contract: "ConditionalTokens", event: "ConditionResolution" }, async ({ event, context }) => {
  // every market of every session asking this question, none for a condition outside Foresight
  const markets = await context.MarketCondition.getWhere({
    conditionId: { _eq: event.params.conditionId.toLowerCase() },
  });

  for (const market of markets) {
    context.MarketCondition.set({ ...market, payoutNumerators: event.params.payoutNumerators });
  }
});
