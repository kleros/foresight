import { S, createEffect } from "envio";

import { getClient } from "../client";
import { getRealityContract, getRealityProxyContract, getSeerMarketContract } from "./contracts";

export const fetchOpeningTime = createEffect(
  {
    name: "fetchOpeningTime",
    input: { chainId: S.number, address: S.string },
    output: S.union([S.number, null]),
    cache: true,
    rateLimit: false,
  },
  async ({ input, context }) => {
    const client = getClient(input.chainId);
    const market = getSeerMarketContract(input.address);

    try {
      const [questionIds, proxyAddress] = await Promise.all([
        client.readContract({ ...market, functionName: "questionsIds" }),
        client.readContract({ ...market, functionName: "realityProxy" }),
      ]);

      // Reality's own id. `questionId` is the Conditional Tokens one, a keccak
      // of these, which Reality would not find. One entry unless multi-scalar.
      const questionId = questionIds[0];
      if (!questionId) {
        context.log.error(`No Reality question on ${input.address}`);
        return null;
      }

      const realityAddress = await client.readContract({
        ...getRealityProxyContract(proxyAddress),
        functionName: "realitio",
      });

      const openingTime = await client.readContract({
        ...getRealityContract(realityAddress),
        functionName: "getOpeningTS",
        args: [questionId],
      });

      return Number(openingTime);
    } catch (error) {
      context.log.error(`Opening time failed for ${input.address}: ${String(error)}`);

      return null;
    }
  },
);
