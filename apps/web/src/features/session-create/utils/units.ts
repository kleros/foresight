/**
 * The units a branch question can be answered in. A unit is not a field on
 * chain: it is appended to the market name, and only the creator keeps it and
 * the bounds in the same scale.
 */

export type Unit = {
  /** What appears in the question, inside the brackets. */
  symbol: string;
  name: string;
  /** The range answers are expected to fall in, where the unit implies one. */
  expected?: { lower: number; upper: number };
};

export const UNITS: Unit[] = [
  { symbol: "%", name: "percent", expected: { lower: 0, upper: 100 } },
  { symbol: "$", name: "US dollars" },
  { symbol: "pts", name: "points" },
  { symbol: "x", name: "multiple" },
  { symbol: "seats", name: "seats" },
];

/** The id the unit select uses for the free-text escape hatch. */
export const OTHER_UNIT = "__other__";

export function findUnit(symbol: string): Unit | undefined {
  return UNITS.find((unit) => unit.symbol === symbol.trim());
}

export function isListedUnit(symbol: string): boolean {
  return findUnit(symbol) !== undefined;
}

/**
 * `$M` and `$k` mean the bounds have to be written in the same multiple. The
 * financial suffixes only: every case would take `km` and `mm` with it.
 */
export function carriesMultiplier(symbol: string): boolean {
  return /[kMBT]$/.test(symbol.trim()) && !isListedUnit(symbol);
}
