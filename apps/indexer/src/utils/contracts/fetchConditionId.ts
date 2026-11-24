import { S, createEffect } from "envio";

import { getClient } from "../client";
import { isContractRefusal } from "./contractRefusal";
import { getSeerMarketContract } from "./contracts";

/** A Seer market's ConditionalTokens condition id, lowercase; null where the market refuses the read. */
export const fetchConditionId = createEffect(
  {
    name: "fetchConditionId",
    input: { chainId: S.number, address: S.string },
    output: S.schema({ conditionId: S.union([S.string, null]) }),
    cache: true,
    rateLimit: false,
  },
  async ({ input, context }) => {
    try {
      const conditionId = await getClient(input.chainId).readContract({
        ...getSeerMarketContract(input.address),
        functionName: "conditionId",
      });

      return { conditionId: conditionId.toLowerCase() };
    } catch (error) {
      if (!isContractRefusal(error)) throw error;
      context.log.error(`conditionId refused for ${input.address}: ${String(error)}`);

      return { conditionId: null };
    }
  },
);
