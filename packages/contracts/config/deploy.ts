import type { HardhatRuntimeEnvironment } from "hardhat/types";

import { Address, isAddress } from "viem";
import { getSeerMarketFactoryAddress } from "./seer";

const LOCAL_DEPLOY_CHAIN_IDS = new Set([31337]);

export function isLocalDeployChain(chainId: number): boolean {
  return LOCAL_DEPLOY_CHAIN_IDS.has(chainId);
}

export type SeerMarketFactoryResolution =
  { kind: "env"; address: Address } | { kind: "config"; address: Address } | { kind: "mock" };

// Resolves seer market factory address from various places
// Order of preference: Env > Config > Mock
// Env can be used to override the seer market factory address in Config
export function resolveSeerMarketFactoryForChainId(
  chainId: number,
  envAddress: string | undefined,
): SeerMarketFactoryResolution {
  if (envAddress && isAddress(envAddress)) {
    return { kind: "env", address: envAddress };
  }

  const configuredAddress = getSeerMarketFactoryAddress(chainId);
  if (configuredAddress) {
    return { kind: "config", address: configuredAddress };
  }

  if (isLocalDeployChain(chainId)) {
    return { kind: "mock" };
  }

  throw new Error(
    `No Seer MarketFactory for chain ${chainId}. Set SEER_MARKET_FACTORY_ADDRESS or add a deployment in @seer-pm/contracts.`,
  );
}

export async function resolveSeerMarketFactory(hre: HardhatRuntimeEnvironment) {
  return resolveSeerMarketFactoryForChainId(Number(await hre.getChainId()), process.env.SEER_MARKET_FACTORY_ADDRESS);
}
