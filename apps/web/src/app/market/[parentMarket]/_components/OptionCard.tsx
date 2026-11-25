import clsx from "clsx";

import { EstimateSlider } from "@/features/predict/components/EstimateSlider";
import { PositionRow } from "@/features/predict/components/PositionRow";
import { useEstimate, useEstimateStore } from "@/features/predict/stores/estimateStore";
import { estimateDirection } from "@/features/predict/utils/estimates";
import type { OptionPosition } from "@/features/predict/utils/position";
import { PnlFlow, type PnlFigures } from "@/features/resolution/components/PnlFigure";
import type { OptionResult } from "@/features/resolution/utils/sessionResults";
import { DisplayBlocks } from "@/features/sessions/components/DisplayBlocks";
import type { SessionOption, SessionStatus } from "@/features/sessions/types";

import { Disclosure } from "@/components/ui/Disclosure";

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
  /** The visitor's realised P&L in the option; undefined where there is none to show. */
  pnl?: PnlFigures;
}

interface ResultLabel {
  text: string;
  className: string;
}

/** The label beside the option's name for each result; none while the option's own read is out. */
function resultLabel(result: OptionResult): ResultLabel | null {
  switch (result.kind) {
    case "final":
      return { text: `Result ${result.text}`, className: "text-fs-tone-success-text" };
    case "waiting":
      return { text: "Waiting for result", className: "text-fs-text-secondary" };
    case "not-selected":
      return { text: "Not selected", className: "text-fs-text-secondary" };
    case "invalid":
      return { text: "Invalid", className: "text-fs-tone-warning-text" };
    case "unread":
      return { text: "Result unknown", className: "text-fs-tone-warning-text" };
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
  pnl,
}: OptionCardProps) {
  const value = useEstimate(parentMarket, option.market);
  const setEstimate = useEstimateStore((state) => state.setEstimate);
  const clearEstimate = useEstimateStore((state) => state.clearEstimate);

  const direction =
    value !== undefined && marketEstimate !== undefined ? estimateDirection(value, marketEstimate) : null;

  return (
    <Disclosure
      className="fs-aurora border-gradient-purple-blue bg-fs-surface w-full rounded-(--fs-radius-panel)!"
      // the 1px transparent border keeps the hover tint off the gradient hairline beneath it
      buttonClassName={clsx(
        "rounded-(--fs-radius-panel) border-transparent bg-transparent bg-clip-padding hover:bg-fs-popup-hover",
        "aria-expanded:rounded-b-none aria-expanded:border-b-(--fs-popup-line)",
      )}
      glyph="chevron"
      title={
        <TitleRow
          option={option}
          isSet={direction !== null}
          label={result ? resultLabel(result) : null}
          pnl={pnl}
          isMuted={result?.kind === "not-selected"}
        />
      }
    >
      <div className="flex w-full flex-col gap-4">
        {result?.kind === "invalid" && result.payouts ? (
          <p className="type-caption text-fs-text-secondary">{result.payouts}</p>
        ) : null}
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
  label,
  pnl,
  isMuted,
}: {
  option: SessionOption;
  isSet: boolean;
  label: ResultLabel | null;
  pnl: PnlFigures | undefined;
  /** A not-selected option: its name in the secondary text tone and its swatch faded, its P&L at full tone. */
  isMuted: boolean;
}) {
  return (
    // the name holds 10rem before the label or the P&L gives way, so on a narrow card they drop under it
    <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
      <div className="flex min-w-0 grow basis-40 flex-wrap items-center gap-x-3 gap-y-0.5">
        <h3
          className={clsx(
            "flex min-w-0 items-center gap-2 text-left font-semibold wrap-break-word",
            isMuted ? "text-fs-text-secondary" : "text-fs-text-primary",
          )}
        >
          <span
            className={clsx("size-2 flex-none rounded-full", isMuted && "opacity-50")}
            style={{ backgroundColor: option.color }}
            aria-hidden
          />
          <span className="min-w-0">{option.name}</span>
        </h3>
        {label ? <span className={clsx("text-sm", label.className)}>{label.text}</span> : null}
      </div>
      {pnl !== undefined ? (
        <PnlFlow cost={pnl.cost} payout={pnl.payout} pnl={pnl.pnl} />
      ) : label ? null : isSet ? (
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
