import { S, createEffect } from "envio";

import { getClient } from "../client";
import { isContractRefusal } from "./contractRefusal";
import { getErc20Contract } from "./contracts";

export const fetchToken = createEffect(
  {
    name: "fetchToken",
    input: { chainId: S.number, address: S.string },
    output: S.schema({
      decimals: S.union([S.number, null]),
      symbol: S.union([S.string, null]),
    }),
    cache: true,
    rateLimit: false,
  },
  async ({ input, context }) => {
    const client = getClient(input.chainId);
    const token = getErc20Contract(input.address);

    const [decimals, symbol] = await Promise.allSettled([
      client.readContract({ ...token, functionName: "decimals" }),
      client.readContract({ ...token, functionName: "symbol" }),
    ]);

    for (const settled of [decimals, symbol]) {
      if (settled.status === "rejected") {
        // Only the contract's own refusal may be cached as null; a transport blip throws and retries.
        if (!isContractRefusal(settled.reason)) throw settled.reason;
        context.log.error(`Token read refused for ${input.address}: ${String(settled.reason)}`);
      }
    }

    return {
      decimals: decimals.status === "fulfilled" ? Number(decimals.value) : null,
      symbol: symbol.status === "fulfilled" ? symbol.value : null,
    };
  },
);
