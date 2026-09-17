import type { OptionScale } from "@/types/optionScale";

/** An estimate that differs from the market's, which is what a prediction is. */
export interface SelectedEstimate {
  scale: OptionScale;
  value: number;
  marketEstimate: number;
  direction: "higher" | "lower";
}
