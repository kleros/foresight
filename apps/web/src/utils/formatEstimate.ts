/** A scalar value in the creator's own unit: `250 $M`, `62.5 %`, or bare; `digits` places at most. */
export function formatEstimate(value: number, unit: string | null, digits = 2): string {
  const amount = value.toLocaleString("en-US", { maximumFractionDigits: digits });
  return unit ? `${amount} ${unit}` : amount;
}
