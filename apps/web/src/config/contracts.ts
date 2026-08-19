import { gnosis, localhost } from "@foresight/contracts";
import type { Address } from "viem";

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
