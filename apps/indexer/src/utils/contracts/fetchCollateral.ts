import { S, createEffect } from "envio";

import { getClient } from "../client";
import { isContractRefusal } from "./contractRefusal";
import { getErc20Contract, getSeerMarketFactoryContract, getSessionFactoryContract } from "./contracts";

/**
 * The seer factory's collateral is what every market in a session mints from.
 */
export const fetchCollateral = createEffect(
  {
    name: "fetchCollateral",
    input: { chainId: S.number, factory: S.string },
    output: S.schema({
      token: S.union([S.string, null]),
      decimals: S.union([S.number, null]),
      symbol: S.union([S.string, null]),
    }),
    cache: true,
    rateLimit: false,
  },
  async ({ input, context }) => {
    const client = getClient(input.chainId);

    let token: string;
    try {
      const seerFactory = await client.readContract({
        ...getSessionFactoryContract(input.factory),
        functionName: "seerMarketFactory",
      });
      token = await client.readContract({
        ...getSeerMarketFactoryContract(seerFactory),
        functionName: "collateralToken",
      });
    } catch (error) {
      if (!isContractRefusal(error)) throw error;
      context.log.error(`Collateral lookup refused via factory ${input.factory}: ${String(error)}`);

      return { token: null, decimals: null, symbol: null };
    }

    const erc20 = getErc20Contract(token);
    const [decimals, symbol] = await Promise.allSettled([
      client.readContract({ ...erc20, functionName: "decimals" }),
      client.readContract({ ...erc20, functionName: "symbol" }),
    ]);
    for (const settled of [decimals, symbol]) {
      if (settled.status === "rejected" && !isContractRefusal(settled.reason)) throw settled.reason;
    }

    return {
      token: token.toLowerCase(),
      decimals: decimals.status === "fulfilled" ? Number(decimals.value) : null,
      symbol: symbol.status === "fulfilled" ? symbol.value : null,
    };
  },
);
