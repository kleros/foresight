import { S, createEffect } from "envio";

import { getClient } from "../client";
import { getSeerMarketContract } from "./contracts";

export const fetchParentMarket = createEffect(
  {
    name: "fetchParentMarket",
    input: { chainId: S.number, address: S.string, outcomeCount: S.number },
    output: S.schema({ marketName: S.string, outcomes: S.array(S.string) }),
    cache: true,
    rateLimit: false,
  },
  async ({ input, context }) => {
    const client = getClient(input.chainId);
    const market = getSeerMarketContract(input.address);

    const [marketName, outcomes] = await Promise.all([
      client.readContract({ ...market, functionName: "marketName" }).catch((error: unknown) => {
        context.log.error(`marketName failed for ${input.address}: ${String(error)}`);

        return "";
      }),
      Promise.all(
        Array.from({ length: input.outcomeCount }, (_, index) =>
          client
            .readContract({ ...market, functionName: "outcomes", args: [BigInt(index)] })
            // a missing outcome must not shorten the array
            .catch(() => ""),
        ),
      ),
    ]);

    return { marketName, outcomes };
  },
);
