/** A scalar value in the creator's own unit: `250 $M`, `62.5 %`, or bare. */
export function formatEstimate(value: number, unit: string | null): string {
  const amount = value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return unit ? `${amount} ${unit}` : amount;
}
