import { formatEther, parseEther } from "viem";

/** Digits, optionally a point, optionally an exponent. No sign. */
const AMOUNT = /^(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

export function isNegativeAmount(value: string): boolean {
  const v = value.trim();
  return v.startsWith("-") && AMOUNT.test(v.slice(1)) && /\d/.test(v);
}

/**
 * `1e-7` and `1.5e21` written out in full. The bound fields hand back
 * `String(someNumber)`, exponent notation below 1e-6 and at or above 1e21.
 */
function expand(digits: string, fraction: string, exponent: number): string {
  const all = `${digits}${fraction}`;
  const point = digits.length + exponent;

  if (point <= 0) return `0.${"0".repeat(-point)}${all}`;
  if (point >= all.length) return `${all}${"0".repeat(point - all.length)}`;
  return `${all.slice(0, point)}.${all.slice(point)}`;
}

/**
 * Wei, or null when the text is not a non-negative decimal. A sign is refused
 * with everything else: the bounds and the bond are `uint256` on chain.
 */
export function scaleToWei(value: string): bigint | null {
  const v = value.trim();
  if (!/\d/.test(v)) return null;

  const parts = AMOUNT.exec(v);
  if (!parts) return null;

  const [, digits = "", fraction = "", exponent] = parts;
  const plain = exponent ? expand(digits, fraction, Number(exponent)) : v;

  try {
    return parseEther(plain);
  } catch {
    return null;
  }
}

/**
 * Back to what was typed, thousands grouped. The digits come from the bigint,
 * so a bound too wide to survive a float still reads as it was written.
 */
export function formatWeiAmount(wei: bigint): string {
  const [whole = "0", fraction] = formatEther(wei).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

/** Exact, never rounded: 1e17, 1.5e18. */
export function formatWeiScientific(wei: bigint): string {
  if (wei === 0n) return "0";
  const digits = wei.toString();
  const exponent = digits.length - 1;
  const mantissa = `${digits[0]}.${digits.slice(1)}`.replace(/\.?0+$/, "");
  return `${mantissa}e${exponent}`;
}
