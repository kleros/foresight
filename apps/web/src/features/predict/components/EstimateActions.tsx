import { Button } from "@kleros/ui-components-library";
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

/** Reset and export, for the estimates that would become predictions. Nothing until one is set. */
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
    <div
      className={clsx(
        "flex w-full flex-wrap justify-between gap-4",
        "flex-col-reverse items-start sm:flex-row sm:items-center",
      )}
    >
      <Button
        variant="secondary"
        small
        text="Reset predictions"
        isDisabled={isDisabled}
        onPress={() => resetEstimates(parentMarket)}
      />
      <LightButton
        small
        text="Export predictions"
        onPress={exportCsv}
        className={clsx(
          "flex-row-reverse p-0",
          "[&_.button-text]:text-fs-accent [&_.button-text]:text-sm [&_.button-text]:font-normal",
          "hover:bg-transparent",
        )}
        icon={<DownloadIcon className="[&_path]:fill-fs-accent! ml-2" />}
      />
    </div>
  );
}
