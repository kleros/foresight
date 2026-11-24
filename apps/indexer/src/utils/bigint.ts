/** 1e18, the scale every price in the schema is quoted at. */
export const WAD = 10n ** 18n;

export const abs = (value: bigint) => (value < 0n ? -value : value);

export const sum = (values: readonly bigint[]) => values.reduce((total, value) => total + value, 0n);

/**
 * `total` split in proportion to `weights` (none negative, one positive): each part floored, then one unit each to the
 * largest remainders, the earliest on a tie, so the parts add up to `total` and a zero weight gets nothing.
 */
export function allocate(total: bigint, weights: readonly bigint[]): bigint[] {
  const whole = sum(weights);
  if (whole <= 0n || weights.some((weight) => weight < 0n)) {
    throw new RangeError(`cannot split ${total} by weights ${weights.join(",")}`);
  }
  const magnitude = abs(total);
  const parts = weights.map((weight) => (magnitude * weight) / whole);
  const remainders = weights.map((weight) => (magnitude * weight) % whole);
  let left = magnitude - sum(parts);
  const order = remainders
    .map((remainder, index) => ({ remainder, index }))
    .sort((a, b) => (a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1));
  for (const { index } of order) {
    if (left === 0n) break;
    parts[index]! += 1n;
    left -= 1n;
  }

  return total < 0n ? parts.map((part) => -part) : parts;
}
