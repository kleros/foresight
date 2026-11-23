import clsx from "clsx";

import { EstimateSlider } from "@/features/predict/components/EstimateSlider";
import { PositionRow } from "@/features/predict/components/PositionRow";
import { useEstimate, useEstimateStore } from "@/features/predict/stores/estimateStore";
import { estimateDirection } from "@/features/predict/utils/estimates";
import type { OptionPosition } from "@/features/predict/utils/position";
import type { OptionResult } from "@/features/resolution/utils/sessionResults";
import { DisplayBlocks } from "@/features/sessions/components/DisplayBlocks";
import type { SessionOption, SessionStatus } from "@/features/sessions/types";

import { Disclosure } from "@/components/ui/Disclosure";
import { StatusChip, type StatusTone } from "@/components/ui/StatusChip";

import CheckCircle from "@/assets/svg/check-circle.svg";
import MinusOutline from "@/assets/svg/minus-outline.svg";

import { STATUS_REASON } from "./statusReason";

interface OptionCardProps {
  option: SessionOption;
  parentMarket: string;
  status: SessionStatus;
  /** Where the market sits now; undefined where the option has no trading. */
  marketEstimate: number | undefined;
  isMarketPending: boolean;
  /** True when the market numbers could not be fetched at all, as opposed to this option having none. */
  isMarketUnavailable?: boolean;
  /** What the trade wallet holds of this option; undefined when it holds none. */
  position?: OptionPosition;
  collateralDecimals?: number;
  /** The option's result once the session resolved. */
  result?: OptionResult;
}

/** The title row's chip for each result; none while the option's own read is out. */
function resultChip(result: OptionResult): { tone: StatusTone; label: string } | null {
  switch (result.kind) {
    case "final":
      return { tone: "done", label: `Result ${result.text}` };
    case "waiting":
      return { tone: "attention", label: "Waiting for result" };
    case "not-selected":
      return { tone: "none", label: "Not selected" };
    case "invalid":
      return { tone: "attention", label: "Invalid" };
    case "unread":
      return { tone: "attention", label: "Result unknown" };
    case "loading":
      return null;
  }
}

const LOCKED: Partial<Record<SessionStatus, string>> = {
  "setting-up": "Opens once the session is set up.",
  closed: "Trading has closed.",
  ...STATUS_REASON,
};

export function OptionCard({
  option,
  parentMarket,
  status,
  marketEstimate,
  isMarketPending,
  isMarketUnavailable = false,
  position,
  collateralDecimals = 18,
  result,
}: OptionCardProps) {
  const value = useEstimate(parentMarket, option.market);
  const setEstimate = useEstimateStore((state) => state.setEstimate);
  const clearEstimate = useEstimateStore((state) => state.clearEstimate);

  const direction =
    value !== undefined && marketEstimate !== undefined ? estimateDirection(value, marketEstimate) : null;

  return (
    <Disclosure
      className={clsx(
        "fs-aurora border-gradient-purple-blue bg-fs-surface w-full rounded-(--fs-radius-panel)!",
        result?.kind === "not-selected" && "opacity-60",
      )}
      // the 1px transparent border keeps the hover tint off the gradient hairline beneath it
      buttonClassName={clsx(
        "rounded-(--fs-radius-panel) border-transparent bg-transparent bg-clip-padding hover:bg-fs-popup-hover",
        "aria-expanded:rounded-b-none aria-expanded:border-b-(--fs-popup-line)",
      )}
      glyph="chevron"
      title={<TitleRow option={option} isSet={direction !== null} chip={result ? resultChip(result) : null} />}
    >
      <div className="flex w-full flex-col gap-4">
        {result?.kind === "invalid" ? <p className="type-caption text-fs-text-secondary">{result.payouts}</p> : null}
        {option.upperBound > option.lowerBound ? (
          <EstimateSlider
            scale={option}
            marketEstimate={marketEstimate}
            isMarketPending={isMarketPending}
            value={value}
            onCommit={(next) => setEstimate(parentMarket, option.market, next)}
            onClear={() => clearEstimate(parentMarket, option.market)}
            lockedReason={
              LOCKED[status] ?? (isMarketUnavailable ? "Could not load the market. Reload in a moment." : undefined)
            }
            finalValue={result?.kind === "final" ? result : undefined}
          />
        ) : (
          <p className="type-caption text-fs-text-secondary">{"This option's range could not be read."}</p>
        )}
        {position ? (
          <PositionRow
            scale={option}
            position={position}
            marketEstimate={marketEstimate}
            decimals={collateralDecimals}
            estimate={direction !== null && value !== undefined ? { value, direction } : undefined}
          />
        ) : null}
        <Disclosure
          className="w-full"
          buttonClassName={clsx(
            "rounded-none border-0 py-3 border-t border-t-(--fs-popup-line) bg-transparent px-0 md:px-0",
            "hover:bg-transparent [&:hover>span]:text-fs-text-secondary",
          )}
          bodyClassName="px-0 pt-2 pb-0 md:px-0 md:pt-2 md:pb-0"
          glyph="chevron"
          title={<span className="text-fs-text-primary fs-echo text-sm font-medium">Details</span>}
        >
          <div className="flex w-full min-w-0 flex-col gap-3">
            <p className="type-caption text-fs-text-secondary text-pretty">{option.question}</p>
            <DisplayBlocks blocks={option.blocks} />
          </div>
        </Disclosure>
      </div>
    </Disclosure>
  );
}

function TitleRow({
  option,
  isSet,
  chip,
}: {
  option: SessionOption;
  isSet: boolean;
  chip: { tone: StatusTone; label: string } | null;
}) {
  return (
    // the name holds 10rem before the chip gives way, so on a narrow card the chip drops under it
    <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
      <div className="flex min-w-0 grow basis-40 items-center gap-2">
        <span className="size-2 flex-none rounded-full" style={{ backgroundColor: option.color }} aria-hidden />
        <h3 className="text-fs-text-primary min-w-0 text-left font-semibold wrap-break-word">{option.name}</h3>
      </div>
      {chip ? (
        <span className="shrink-0">
          <StatusChip tone={chip.tone} label={chip.label} />
        </span>
      ) : isSet ? (
        <CheckCircle
          className="text-fs-tone-success-text size-4 shrink-0 [&_path]:fill-current"
          role="img"
          aria-label="Estimate set"
        />
      ) : (
        <MinusOutline className="text-fs-popup-text-3 size-4 shrink-0 [&_path]:fill-current" aria-hidden />
      )}
    </div>
  );
}
