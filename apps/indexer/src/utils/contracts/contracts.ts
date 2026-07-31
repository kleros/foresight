import type { Address } from "viem";

import { abi as seerMarketAbi } from "../../../abis/SeerMarket";

export const getSeerMarketContract = (address: string) =>
  ({
    address: address as Address,
    abi: seerMarketAbi,
  }) as const;
