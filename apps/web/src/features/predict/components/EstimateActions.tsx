import clsx from "clsx";

import LightButton from "@/components/ui/LightButton";

import DownloadIcon from "@/assets/svg/download.svg";

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
  isDisabled?: boolean;
}

/** Export and reset, as text actions, for the estimates that would become predictions. Nothing until one is set. */
export function EstimateActions({ parentMarket, scales, marketEstimates, isDisabled }: EstimateActionsProps) {
  const estimates = useSessionEstimates(parentMarket);
  const resetEstimates = useEstimateStore((state) => state.resetEstimates);

  const selected = selectedEstimates(scales, estimates, marketEstimates);
  if (selected.length === 0) return null;

  const exportCsv = () =>
    downloadTextFile(
      `estimates-${fileStamp(new Date())}.csv`,
      serializeEstimateCsv(selected.map(({ scale, value }) => ({ name: scale.name, estimate: value }))),
      "text/csv",
    );

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <LightButton
        small
        text="Export estimates"
        onPress={exportCsv}
        className={clsx(LINK, "flex-row-reverse")}
        icon={<DownloadIcon className="[&_path]:fill-fs-text-accent! ml-2" />}
      />
      <LightButton
        small
        text="Reset estimates"
        isDisabled={isDisabled}
        onPress={() => resetEstimates(parentMarket)}
        className={LINK}
      />
    </div>
  );
}

/** Text actions beside the option cards: no fill, accent text, an underline on hover. */
export const LINK = clsx(
  "p-0 hover:bg-transparent",
  "[&_.button-text]:text-fs-text-accent [&_.button-text]:text-sm [&_.button-text]:font-normal",
  "hover:[&_.button-text]:underline",
);
