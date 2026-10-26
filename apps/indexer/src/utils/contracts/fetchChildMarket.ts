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
      invalid: S.string,
      underlying: S.string,
    }),
    cache: true,
    rateLimit: false,
  },
  async ({ input, context }) => {
    const client = getClient(input.chainId);
    const market = getSeerMarketContract(input.address);

    try {
      // outcome 0 is DOWN and 1 is UP; Seer wraps INVALID one past the named outcomes
      const [marketName, lowerBound, upperBound, down, up, invalid, underlying] = await Promise.all([
        client.readContract({ ...market, functionName: "marketName" }),
        client.readContract({ ...market, functionName: "lowerBound" }),
        client.readContract({ ...market, functionName: "upperBound" }),
        client.readContract({ ...market, functionName: "wrappedOutcome", args: [0n] }),
        client.readContract({ ...market, functionName: "wrappedOutcome", args: [1n] }),
        client.readContract({ ...market, functionName: "wrappedOutcome", args: [2n] }),
        client.readContract({ ...market, functionName: "parentWrappedOutcome" }),
      ]);

      return {
        marketName,
        lowerBound,
        upperBound,
        down: down[0].toLowerCase(),
        up: up[0].toLowerCase(),
        invalid: invalid[0].toLowerCase(),
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
        invalid: UNAVAILABLE,
        underlying: UNAVAILABLE,
      };
    }
  },
);
