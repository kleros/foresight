import { localhost } from "@foresight/contracts";
import type { Address } from "viem";

import { DEFAULT_CHAIN_ID } from "./chains";

export const sessionFactoryAbi = localhost.sessionFactoryAbi;

const SESSION_FACTORY_ADDRESSES: Record<number, Address> = localhost.sessionFactoryAddress;

export function sessionFactoryAddress(chainId: number = DEFAULT_CHAIN_ID): Address | null {
  return SESSION_FACTORY_ADDRESSES[chainId] ?? null;
}
