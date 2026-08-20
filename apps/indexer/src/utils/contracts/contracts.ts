import type { Address } from "viem";

import { abi as realityAbi } from "../../../abis/Reality";
import { abi as realityProxyAbi } from "../../../abis/RealityProxy";
import { abi as seerMarketAbi } from "../../../abis/SeerMarket";

export const getSeerMarketContract = (address: string) =>
  ({
    address: address as Address,
    abi: seerMarketAbi,
  }) as const;

export const getRealityProxyContract = (address: string) =>
  ({
    address: address as Address,
    abi: realityProxyAbi,
  }) as const;

export const getRealityContract = (address: string) =>
  ({
    address: address as Address,
    abi: realityAbi,
  }) as const;
