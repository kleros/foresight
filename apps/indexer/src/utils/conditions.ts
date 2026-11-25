import type { EvmOnEventContext } from "envio";

import { fetchConditionId } from "./contracts/fetchConditionId";

/** Records `market`'s condition, with its payouts where the condition already resolved. */
export async function noteCondition(context: EvmOnEventContext, chainId: number, market: string) {
  const { conditionId } = await context.effect(fetchConditionId, { chainId, address: market });
  if (conditionId === null) return;

  const resolution = await context.ResolvedCondition.get(conditionId);
  context.MarketCondition.set({
    id: market.toLowerCase(),
    conditionId,
    payoutNumerators: resolution?.payoutNumerators ?? [],
  });
}
