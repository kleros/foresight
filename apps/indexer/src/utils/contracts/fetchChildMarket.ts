import { S, createEffect } from "envio";

import { getClient } from "../client";
import { getSeerMarketContract } from "./contracts";

export const fetchChildMarket = createEffect(
  {
    name: "fetchChildMarket",
    input: { chainId: S.number, address: S.string },
    output: S.schema({ marketName: S.string, lowerBound: S.bigint, upperBound: S.bigint }),
    cache: true,
    rateLimit: false,
  },
  async ({ input, context }) => {
    const client = getClient(input.chainId);
    const market = getSeerMarketContract(input.address);

    try {
      const [marketName, lowerBound, upperBound] = await Promise.all([
        client.readContract({ ...market, functionName: "marketName" }),
        client.readContract({ ...market, functionName: "lowerBound" }),
        client.readContract({ ...market, functionName: "upperBound" }),
      ]);

      return { marketName, lowerBound, upperBound };
    } catch (error) {
      context.log.error(`Child market read failed for ${input.address}: ${String(error)}`);

      return { marketName: "", lowerBound: 0n, upperBound: 0n };
    }
  },
);
