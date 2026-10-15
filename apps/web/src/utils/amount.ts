import { formatEther, formatUnits, parseUnits } from "viem";

/** A wad is a 1e18 fixed-point value (the indexer's prices and bounds); back to a plain number. */
export const fromWad = (value: string): number => Number(formatEther(BigInt(value)));

/** Null unless the input is a positive decimal the token's precision can hold. */
export function parseAmount(raw: string, decimals: number): bigint | null {
  const trimmed = raw.trim();
  if (!/^\d+(\.\d*)?$/.test(trimmed)) return null;

  const fraction = trimmed.split(".")[1] ?? "";
  if (fraction.length > decimals) return null;

  const value = parseUnits(trimmed, decimals);
  return value > 0n ? value : null;
}

/**
 * A number to its token's base units. Scaling by hand rather than through `parseUnits`: every
 * decimal string a number produces goes exponential somewhere — below 1e-7 with `String`, at
 * 1e21 and above even with `toFixed` — and both ends are reachable.
 */
export function scaleAmount(value: number, decimals: number): bigint {
  if (!Number.isFinite(value)) return 0n;

  const unit = 10n ** BigInt(decimals);
  const whole = Math.trunc(value);
  return BigInt(whole) * unit + BigInt(Math.round((value - whole) * Number(unit)));
}

/** Decimals `formatAmount` shows by default; anything finer is cut. */
export const DISPLAY_DECIMALS = 6;

export function formatAmount(value: bigint, decimals: number, digits = DISPLAY_DECIMALS): string {
  const [whole = "0", fraction = ""] = formatUnits(value, decimals).split(".");
  const trimmed = fraction.slice(0, digits).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

/** Decimals shown for an amount the visitor holds. */
export const OWNED_DECIMALS = 4;

/** A held amount cut, never rounded up, to `OWNED_DECIMALS`; a non-zero amount below the last one is named. */
export function ownedAmount(value: bigint, decimals: number): string {
  const shown = formatAmount(value, decimals, OWNED_DECIMALS);
  if (shown !== "0" || value <= 0n) return shown;
  return `less than ${formatAmount(10n ** BigInt(Math.max(decimals - OWNED_DECIMALS, 0)), decimals)}`;
}
