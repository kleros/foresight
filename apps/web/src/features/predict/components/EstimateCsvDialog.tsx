import { useState } from "react";

import { Button, FileUploader } from "@kleros/ui-components-library";
import clsx from "clsx";

import { Dialog } from "@/components/ui/Dialog";
import LightButton from "@/components/ui/LightButton";

import UploadIcon from "@/assets/svg/upload.svg";

import { downloadTextFile } from "@/utils/download";
import { successToast } from "@/utils/toast";

import type { OptionScale } from "@/types/optionScale";

import { LINK } from "./EstimateActions";
import { useEstimateStore, useSessionEstimates } from "../stores/estimateStore";
import { CSV_COLUMNS, parseEstimateCsv, serializeEstimateCsv } from "../utils/estimateCsv";

interface EstimateCsvDialogProps {
  parentMarket: string;
  scales: OptionScale[];
  marketEstimates: Record<string, number | undefined>;
  /** The creator's plural noun, already lowercased. */
  noun: string;
  isDisabled?: boolean;
}

/** A button and its dialog: estimates for every option at once, from a two-column CSV. */
export function EstimateCsvDialog({ parentMarket, scales, marketEstimates, noun, isDisabled }: EstimateCsvDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [file, setFile] = useState<File>();
  const [error, setError] = useState<string>();

  const estimates = useSessionEstimates(parentMarket);
  const setEstimate = useEstimateStore((state) => state.setEstimate);
  const clearEstimate = useEstimateStore((state) => state.clearEstimate);

  const close = () => {
    setIsOpen(false);
    setFile(undefined);
    setError(undefined);
  };

  const templateRows = scales.map((scale) => ({
    name: scale.name,
    estimate: estimates[scale.market.toLowerCase()] ?? null,
  }));

  const load = async () => {
    if (!file) return;
    try {
      const parsed = parseEstimateCsv(await file.text(), scales);
      for (const { scale, value } of parsed) {
        // an empty row, or one at the market's own number, is no prediction, same as the slider left there
        if (value === null || value === marketEstimates[scale.market.toLowerCase()]) {
          clearEstimate(parentMarket, scale.market);
        } else setEstimate(parentMarket, scale.market, value);
      }
      successToast("Estimates loaded.");
      close();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "This file could not be read.");
    }
  };

  return (
    <>
      <LightButton
        small
        text="Upload estimates (CSV)"
        isDisabled={isDisabled}
        onPress={() => setIsOpen(true)}
        className={clsx(LINK, "flex-row-reverse")}
        icon={<UploadIcon className="[&_path]:fill-fs-text-accent! ml-2" />}
      />
      <Dialog
        isOpen={isOpen}
        onClose={close}
        title="Upload estimates (CSV)"
        hint="Each row is a name and your estimate for it."
        className="w-full md:w-162"
      >
        <div className="bg-fs-surface-tint rounded-fs flex flex-col gap-2 px-4 pt-3 pb-4">
          <h3 className="text-fs-text-primary text-sm">Required columns</h3>
          <pre className="border-fs-border rounded-fs bg-fs-surface text-fs-text-primary overflow-x-auto border p-4 text-sm">
            <span className="text-fs-text-secondary">{CSV_COLUMNS.join(",")}</span>
            {templateRows.slice(0, 2).map((row) => `\n${row.name},${row.estimate ?? ""}`)}
            {templateRows.length > 2 ? <span className="text-fs-text-secondary">{"\n…"}</span> : null}
          </pre>
          <p className="text-fs-text-primary text-sm">
            Names must match the {noun} on this page. An estimate outside its range is refused.
          </p>
        </div>

        <LightButton
          small
          text="Download CSV template"
          className="self-start p-0 [&_.button-text]:text-fs-accent [&_.button-text]:text-sm [&_.button-text]:font-normal"
          onPress={() => downloadTextFile("estimates-template.csv", serializeEstimateCsv(templateRows), "text/csv")}
        />

        <FileUploader
          className="w-full [&_small]:top-0 [&_small]:text-sm"
          callback={(chosen) => {
            setError(undefined);
            setFile(chosen);
          }}
          acceptedFileTypes={[".csv", "text/csv"]}
          selectedFile={file}
          msg={error ?? "A .csv file with the columns above"}
          variant={error ? "error" : "info"}
        />

        <div className="flex w-full flex-row justify-center gap-3.5 max-md:flex-col-reverse">
          <Button text="Close" variant="secondary" onPress={close} />
          <Button text="Load estimates" isDisabled={!file} onPress={() => void load()} />
        </div>
      </Dialog>
    </>
  );
}
