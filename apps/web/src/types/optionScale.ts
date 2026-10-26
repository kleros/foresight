import type { Address } from "viem";

/** One option's scale, as the creator set it: a name, a colour, a unit and its bounds. */
export interface OptionScale {
  market: Address;
  name: string;
  color: string;
  /** Parsed from the market name's `[unit]` suffix; null where the name carries none. */
  unit: string | null;
  /** Scalar bounds in the unit's own terms, de-scaled from 1e18. */
  lowerBound: number;
  upperBound: number;
}
