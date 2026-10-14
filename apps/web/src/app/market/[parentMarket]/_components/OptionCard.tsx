import clsx from "clsx";

import { EstimateSlider } from "@/features/predict/components/EstimateSlider";
import { PositionRow } from "@/features/predict/components/PositionRow";
import { useEstimate, useEstimateStore } from "@/features/predict/stores/estimateStore";
import { estimateDirection } from "@/features/predict/utils/estimates";
import { POSITION_DIGITS, positionWorth, type OptionPosition } from "@/features/predict/utils/position";
import { DisplayBlocks } from "@/features/sessions/components/DisplayBlocks";
import type { SessionOption, SessionStatus } from "@/features/sessions/types";

import { Disclosure } from "@/components/ui/Disclosure";

import CheckCircle from "@/assets/svg/check-circle.svg";
import ArrowDown from "@/assets/svg/long-arrow-down.svg";
import ArrowUp from "@/assets/svg/long-arrow-up.svg";

import { formatAmount } from "@/utils/amount";
import { formatEstimate } from "@/utils/formatEstimate";

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
}

const LOCKED: Partial<Record<SessionStatus, string>> = {
  "setting-up": "Estimates open once every option is set up.",
  closed: "Trading has closed for this session.",
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
}: OptionCardProps) {
  const value = useEstimate(parentMarket, option.market);
  const setEstimate = useEstimateStore((state) => state.setEstimate);
  const clearEstimate = useEstimateStore((state) => state.clearEstimate);

  const direction =
    value !== undefined && marketEstimate !== undefined ? estimateDirection(value, marketEstimate) : null;

  return (
    <Disclosure
      className="bg-fs-surface-sunken w-full"
      title={
        <TitleRow
          option={option}
          held={
            position &&
            (marketEstimate === undefined
              ? `${formatAmount(position.up, collateralDecimals, POSITION_DIGITS)} UP · ${formatAmount(position.down, collateralDecimals, POSITION_DIGITS)} DOWN`
              : `≈ ${formatAmount(positionWorth(position, marketEstimate, option), collateralDecimals, POSITION_DIGITS)} ${option.name} tokens`)
          }
          readout={
            direction !== null && value !== undefined && marketEstimate !== undefined
              ? { value, marketEstimate, direction }
              : undefined
          }
        />
      }
    >
      <div className="flex w-full flex-col gap-4">
        {option.upperBound > option.lowerBound ? (
          <EstimateSlider
            scale={option}
            marketEstimate={marketEstimate}
            isMarketPending={isMarketPending}
            value={value}
            onCommit={(next) => setEstimate(parentMarket, option.market, next)}
            onClear={() => clearEstimate(parentMarket, option.market)}
            lockedReason={
              LOCKED[status] ??
              (isMarketUnavailable ? "Market estimates could not be loaded. Reload in a moment." : undefined)
            }
          />
        ) : (
          <p className="type-caption text-fs-text-secondary">The scale for this option could not be read.</p>
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
          buttonClassName="w-fit gap-2 border-none bg-transparent px-0 py-1 md:px-0 hover:bg-transparent hover:text-fs-text-accent"
          bodyClassName="px-0 pt-2 pb-0 md:px-0 md:pt-2 md:pb-0"
          title={<span className="type-label text-fs-text-secondary">Details</span>}
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
  held,
  readout,
}: {
  option: SessionOption;
  /** The position's worth, already worded; shown from md up, and in full in the open card. */
  held?: string;
  readout?: { value: number; marketEstimate: number; direction: "higher" | "lower" };
}) {
  const Arrow = readout?.direction === "higher" ? ArrowUp : ArrowDown;
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <div className="flex min-w-0 items-center gap-2">
        <span className="size-2 flex-none rounded-full" style={{ backgroundColor: option.color }} aria-hidden />
        <h3 className="text-fs-text-primary min-w-0 text-left font-semibold wrap-break-word">{option.name}</h3>
      </div>
      <div className="flex items-center gap-3">
        {held ? (
          <span className="type-label text-fs-text-secondary border-fs-border hidden border-r pr-3 tabular-nums md:inline">
            Position <span className="text-fs-text-primary font-semibold">{held}</span>
          </span>
        ) : null}
        {readout ? (
          <span className="type-label flex items-center gap-1.5 tabular-nums">
            <span className="text-fs-text-primary font-semibold">{formatEstimate(readout.value, option.unit)}</span>
            <span
              className={clsx(
                "inline-flex items-center gap-1",
                readout.direction === "higher" ? "text-fs-tone-success-text" : "text-fs-tone-error-text",
              )}
            >
              <Arrow className="size-3 shrink-0 [&_path]:fill-current" aria-hidden />
              market {formatEstimate(readout.marketEstimate, option.unit)}
            </span>
            <CheckCircle className="ml-1 size-4 shrink-0" role="img" aria-label="Estimate set" />
          </span>
        ) : (
          <span className="type-label text-fs-text-secondary">Not set</span>
        )}
      </div>
    </div>
  );
}
