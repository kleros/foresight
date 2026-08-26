import { formatUnits, parseUnits } from "viem";

/** Null unless the input is a positive decimal the token's precision can hold. */
export function parseAmount(raw: string, decimals: number): bigint | null {
  const trimmed = raw.trim();
  if (!/^\d+(\.\d*)?$/.test(trimmed)) return null;

  const fraction = trimmed.split(".")[1] ?? "";
  if (fraction.length > decimals) return null;

  const value = parseUnits(trimmed, decimals);
  return value > 0n ? value : null;
}

const DISPLAY_DECIMALS = 6;

export function formatAmount(value: bigint, decimals: number): string {
  const [whole = "0", fraction = ""] = formatUnits(value, decimals).split(".");
  const trimmed = fraction.slice(0, DISPLAY_DECIMALS).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}
