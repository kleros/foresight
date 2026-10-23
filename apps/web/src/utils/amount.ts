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
 * `value` as the shortest plain decimal that reads back as it, which is what was typed or stepped to. `String` gives
 * that decimal, but in exponent notation below 1e-6 and from 1e21, which `parseUnits` refuses, so it is written out.
 */
function plainDecimal(value: number): string {
  const [mantissa = "0", exponent = "0"] = String(value).toLowerCase().split("e");
  const sign = mantissa.startsWith("-") ? "-" : "";
  const [whole = "0", fraction = ""] = mantissa.replace("-", "").split(".");
  const digits = whole + fraction;
  const point = whole.length + Number(exponent);
  if (point <= 0) return `${sign}0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${"0".repeat(point - digits.length)}`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

/** A number to its token's base units, from its decimal rather than float arithmetic, rounded past `decimals`. */
export function scaleAmount(value: number, decimals: number): bigint {
  if (!Number.isFinite(value)) return 0n;
  return parseUnits(plainDecimal(value), decimals);
}

/** Decimals `formatAmount` shows by default; anything finer is cut. */
export const DISPLAY_DECIMALS = 6;

export function formatAmount(value: bigint, decimals: number, digits = DISPLAY_DECIMALS): string {
  const [whole = "0", fraction = ""] = formatUnits(value, decimals).split(".");
  const trimmed = fraction.slice(0, digits).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

/** `formatAmount` for the screen, its whole part grouped in threes; never for a value read back as a number. */
export function formatDisplayAmount(value: bigint, decimals: number, digits = DISPLAY_DECIMALS): string {
  const [whole = "0", fraction] = formatAmount(value, decimals, digits).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+$)/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

/** Decimals shown for an amount the visitor holds. */
export const OWNED_DECIMALS = 4;

/** A held amount cut to `OWNED_DECIMALS`, so it equals what `ownedAmount` shows. */
export function cutToOwned(value: bigint, decimals: number): bigint {
  const step = 10n ** BigInt(Math.max(decimals - OWNED_DECIMALS, 0));
  return value - (value % step);
}

/** A held amount cut, never rounded up, to `OWNED_DECIMALS`; a non-zero amount below the last one is named. */
export function ownedAmount(value: bigint, decimals: number): string {
  const shown = formatDisplayAmount(value, decimals, OWNED_DECIMALS);
  if (shown !== "0" || value <= 0n) return shown;
  return `less than ${formatAmount(10n ** BigInt(Math.max(decimals - OWNED_DECIMALS, 0)), decimals)}`;
}
