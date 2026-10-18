import { gnosis, localhost } from "@foresight/contracts";
import { isAddressEqual, type Address } from "viem";

import { DEFAULT_CHAIN_ID } from "./chains";

/** Same contract on both; localhost's regenerates on every `deploy:local`. */
export const sessionFactoryAbi = localhost.sessionFactoryAbi;

const SESSION_FACTORY_ADDRESSES: Record<number, Address> = {
  ...localhost.sessionFactoryAddress,
  ...gnosis.sessionFactoryAddress,
};

export function sessionFactoryAddress(chainId: number = DEFAULT_CHAIN_ID): Address | null {
  return SESSION_FACTORY_ADDRESSES[chainId] ?? null;
}

export const tradeExecutorFactoryAbi = localhost.tradeExecutorFactoryAbi;

export const tradeExecutorAbi = localhost.tradeExecutorAbi;

const TRADE_EXECUTOR_FACTORY_ADDRESSES: Record<number, Address> = {
  ...localhost.tradeExecutorFactoryAddress,
  ...gnosis.tradeExecutorFactoryAddress,
};

export function tradeExecutorFactoryAddress(chainId: number = DEFAULT_CHAIN_ID) {
  return TRADE_EXECUTOR_FACTORY_ADDRESSES[chainId] ?? null;
}

/** Seer's router; splits, merges and redeems for any of its markets. Deployed on gnosis only. */
export const gnosisRouterAbi = gnosis.gnosisRouterAbi;

const GNOSIS_ROUTER_ADDRESSES: Record<number, Address> = { ...gnosis.gnosisRouterAddress };

export function gnosisRouterAddress(chainId: number = DEFAULT_CHAIN_ID): Address | null {
  return GNOSIS_ROUTER_ADDRESSES[chainId] ?? null;
}

/** Same contracts on both; gnosis' manager spends real sDAI, the local one a mintable stand-in. */
export const foresightCreditsAbi = localhost.foresightCreditsAbi;

export const creditsManagerAbi = localhost.creditsManagerAbi;

export type CreditsContracts = { credits: Address; manager: Address };

const FORESIGHT_CREDITS_ADDRESSES: Record<number, Address> = {
  ...localhost.foresightCreditsAddress,
  ...gnosis.foresightCreditsAddress,
};
const CREDITS_MANAGER_ADDRESSES: Record<number, Address> = {
  ...localhost.creditsManagerAddress,
  ...gnosis.creditsManagerAddress,
};

export function creditsContracts(chainId: number = DEFAULT_CHAIN_ID): CreditsContracts | null {
  const credits = FORESIGHT_CREDITS_ADDRESSES[chainId];
  const manager = CREDITS_MANAGER_ADDRESSES[chainId];
  if (!credits || !manager) return null;

  return { credits, manager };
}

export const sDaiAdapterAbi = gnosis.savingsXDaiAdapterAbi;

const S_DAI_ADDRESSES: Record<number, Address> = { ...gnosis.savingsXDaiAddress };
const S_DAI_ADAPTER_ADDRESSES: Record<number, Address> = { ...gnosis.savingsXDaiAdapterAddress };

export type SDaiDepositRoute = { sDai: Address; sDaiAdapter: Address };

/**
 * Gnosis' savings adapter takes xDAI and mints sDAI to whichever address is named, so
 * native currency can fund a market only where sDAI is its collateral.
 */
export function sDaiDepositRoute(collateral: Address, chainId: number = DEFAULT_CHAIN_ID): SDaiDepositRoute | null {
  const sDai = S_DAI_ADDRESSES[chainId];
  const sDaiAdapter = S_DAI_ADAPTER_ADDRESSES[chainId];
  if (!sDai || !sDaiAdapter || !isAddressEqual(sDai, collateral)) return null;

  return { sDai, sDaiAdapter };
}
