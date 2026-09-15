import { S, createEffect } from "envio";

import { getClient } from "../client";
import { UNAVAILABLE } from "../unavailable";
import { isContractRefusal } from "./contractRefusal";
import { getSeerMarketContract } from "./contracts";

export const fetchParentMarket = createEffect(
  {
    name: "fetchParentMarket",
    input: { chainId: S.number, address: S.string, outcomeCount: S.number },
    output: S.schema({
      marketName: S.string,
      outcomes: S.array(S.string),
      // wrapped ERC-20 per named outcome;
      outcomeTokens: S.array(S.string),
      invalidToken: S.union([S.string, null]),
    }),
    cache: true,
    rateLimit: false,
  },
  async ({ input, context }) => {
    const client = getClient(input.chainId);
    const market = getSeerMarketContract(input.address);

    const [marketName, outcomes, outcomeTokens, invalid] = await Promise.all([
      client.readContract({ ...market, functionName: "marketName" }).catch((error: unknown) => {
        context.log.error(`marketName failed for ${input.address}: ${String(error)}`);

        return UNAVAILABLE;
      }),
      Promise.all(
        Array.from({ length: input.outcomeCount }, (_, index) =>
          client
            .readContract({ ...market, functionName: "outcomes", args: [BigInt(index)] })
            // a missing outcome must not shorten the array
            .catch(() => UNAVAILABLE),
        ),
      ),
      Promise.all(
        Array.from({ length: input.outcomeCount }, (_, index) =>
          client
            .readContract({ ...market, functionName: "wrappedOutcome", args: [BigInt(index)] })
            .then(([token]) => token.toLowerCase())
            .catch(() => UNAVAILABLE),
        ),
      ),
      // Seer wraps INVALID one past the named outcomes
      client
        .readContract({ ...market, functionName: "wrappedOutcome", args: [BigInt(input.outcomeCount)] })
        .catch((error: unknown) => {
          // Only the contract's own refusal may be cached as null; a transport blip throws and retries.
          if (!isContractRefusal(error)) throw error;
          context.log.error(`INVALID outcome token refused for ${input.address}: ${String(error)}`);

          return null;
        }),
    ]);

    return { marketName, outcomes, outcomeTokens, invalidToken: invalid ? invalid[0].toLowerCase() : null };
  },
);
