import type { EvmOnEventContext } from "envio";

import { fetchConditionId } from "./contracts/fetchConditionId";

/** Records `market`'s condition, with the payouts of any market already sharing it. */
export async function noteCondition(context: EvmOnEventContext, chainId: number, market: string) {
  const { conditionId } = await context.effect(fetchConditionId, { chainId, address: market });
  if (conditionId === null) return;

  const [sibling] = await context.MarketCondition.getWhere({ conditionId: { _eq: conditionId } });
  context.MarketCondition.set({
    id: market.toLowerCase(),
    conditionId,
    payoutNumerators: sibling?.payoutNumerators ?? [],
  });
}
