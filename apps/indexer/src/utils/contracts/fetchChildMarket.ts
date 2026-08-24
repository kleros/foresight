import { S, createEffect } from "envio";

import { getClient } from "../client";
import { UNAVAILABLE } from "../unavailable";
import { getSeerMarketContract } from "./contracts";

export const fetchChildMarket = createEffect(
  {
    name: "fetchChildMarket",
    input: { chainId: S.number, address: S.string },
    output: S.schema({
      marketName: S.string,
      lowerBound: S.bigint,
      upperBound: S.bigint,
      down: S.string,
      up: S.string,
      underlying: S.string,
    }),
    cache: true,
    rateLimit: false,
  },
  async ({ input, context }) => {
    const client = getClient(input.chainId);
    const market = getSeerMarketContract(input.address);

    try {
      // outcome 0 is DOWN and outcome 1 is UP
      const [marketName, lowerBound, upperBound, down, up, underlying] = await Promise.all([
        client.readContract({ ...market, functionName: "marketName" }),
        client.readContract({ ...market, functionName: "lowerBound" }),
        client.readContract({ ...market, functionName: "upperBound" }),
        client.readContract({ ...market, functionName: "wrappedOutcome", args: [0n] }),
        client.readContract({ ...market, functionName: "wrappedOutcome", args: [1n] }),
        client.readContract({ ...market, functionName: "parentWrappedOutcome" }),
      ]);

      return {
        marketName,
        lowerBound,
        upperBound,
        down: down[0].toLowerCase(),
        up: up[0].toLowerCase(),
        underlying: underlying[0].toLowerCase(),
      };
    } catch (error) {
      context.log.error(`Child market read failed for ${input.address}: ${String(error)}`);

      return {
        marketName: UNAVAILABLE,
        lowerBound: 0n,
        upperBound: 0n,
        down: UNAVAILABLE,
        up: UNAVAILABLE,
        underlying: UNAVAILABLE,
      };
    }
  },
);
