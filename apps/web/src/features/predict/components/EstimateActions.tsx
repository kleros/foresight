import LightButton from "@/components/ui/LightButton";

import { fileStamp } from "@/utils/date";
import { downloadTextFile } from "@/utils/download";

import type { OptionScale } from "@/types/optionScale";

import { useEstimateStore, useSessionEstimates } from "../stores/estimateStore";
import { serializeEstimateCsv } from "../utils/estimateCsv";
import { selectedEstimates } from "../utils/estimates";

interface EstimateActionsProps {
  parentMarket: string;
  scales: OptionScale[];
  marketEstimates: Record<string, number | undefined>;
  /** The creator's plural noun, already lowercased. */
  noun: string;
}

/** Reset and export, for the estimates that would become predictions. Nothing until one is set. */
export function EstimateActions({ parentMarket, scales, marketEstimates, noun }: EstimateActionsProps) {
  const estimates = useSessionEstimates(parentMarket);
  const resetEstimates = useEstimateStore((state) => state.resetEstimates);

  const selected = selectedEstimates(scales, estimates, marketEstimates);
  if (selected.length === 0) return null;
  const settable = scales.filter((scale) => marketEstimates[scale.market.toLowerCase()] !== undefined).length;

  const exportCsv = () =>
    downloadTextFile(
      `estimates-${fileStamp(new Date())}.csv`,
      serializeEstimateCsv(selected.map(({ scale, value }) => ({ name: scale.name, estimate: value }))),
      "text/csv",
    );

  return (
    <div className="flex w-full flex-wrap items-center justify-between gap-2">
      <p className="text-fs-text-secondary text-sm">
        {selected.length} of {settable} {noun} set
      </p>
      <div className="flex items-center gap-2">
        <LightButton small text="Reset estimates" onPress={() => resetEstimates(parentMarket)} />
        <LightButton small text="Export estimates" onPress={exportCsv} />
      </div>
    </div>
  );
}
