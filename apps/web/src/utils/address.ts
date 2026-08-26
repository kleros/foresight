import { isAddress, type Address } from "viem";

export const shortenAddress = (address: string, chars = 4) =>
  address.length > chars * 2 + 2 ? `${address.slice(0, chars + 2)}...${address.slice(-chars)}` : address;

/** Null while the field is empty or not yet a full address. */
export function parseTokenAddress(raw: string): Address | null {
  const trimmed = raw.trim();
  return isAddress(trimmed) ? trimmed : null;
}
