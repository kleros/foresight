import type { Abi, Address } from "viem";

export type ContractConfig = {
  address: Record<number, Address>;
  abi: Abi;
};

export function getAddress(config: ContractConfig, chainId: number) {
  const address = config.address[chainId];
  if (!address) {
    throw new Error(`No address found for chainId ${chainId}`);
  }
  return address;
}
