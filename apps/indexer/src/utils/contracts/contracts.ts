import type { Address } from "viem";

import { abi as erc20Abi } from "../../../abis/Erc20";
import { abi as realityAbi } from "../../../abis/Reality";
import { abi as realityProxyAbi } from "../../../abis/RealityProxy";
import { abi as seerMarketAbi } from "../../../abis/SeerMarket";
import { abi as seerMarketFactoryAbi } from "../../../abis/SeerMarketFactory";
import { abi as sessionFactoryViewsAbi } from "../../../abis/SessionFactoryViews";

export const getSeerMarketContract = (address: string) =>
  ({
    address: address as Address,
    abi: seerMarketAbi,
  }) as const;

export const getErc20Contract = (address: string) =>
  ({
    address: address as Address,
    abi: erc20Abi,
  }) as const;

export const getSessionFactoryContract = (address: string) =>
  ({
    address: address as Address,
    abi: sessionFactoryViewsAbi,
  }) as const;

export const getSeerMarketFactoryContract = (address: string) =>
  ({
    address: address as Address,
    abi: seerMarketFactoryAbi,
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
