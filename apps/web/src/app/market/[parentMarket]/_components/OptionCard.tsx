import { EstimateSlider } from "@/features/predict/components/EstimateSlider";
import { PositionRow } from "@/features/predict/components/PositionRow";
import { useEstimate, useEstimateStore } from "@/features/predict/stores/estimateStore";
import { estimateDirection } from "@/features/predict/utils/estimates";
import type { OptionPosition } from "@/features/predict/utils/position";
import { DisplayBlocks } from "@/features/sessions/components/DisplayBlocks";
import type { SessionOption, SessionStatus } from "@/features/sessions/types";

import { Disclosure } from "@/components/ui/Disclosure";

import CheckCircle from "@/assets/svg/check-circle.svg";
import MinusOutline from "@/assets/svg/minus-outline.svg";

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
      title={<TitleRow option={option} isSet={direction !== null} />}
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

function TitleRow({ option, isSet }: { option: SessionOption; isSet: boolean }) {
  return (
    <div className="flex min-w-0 flex-1 items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-2">
        <span className="size-2 flex-none rounded-full" style={{ backgroundColor: option.color }} aria-hidden />
        <h3 className="text-fs-text-primary min-w-0 text-left font-semibold wrap-break-word">{option.name}</h3>
      </div>
      {isSet ? (
        <CheckCircle className="size-4 shrink-0" role="img" aria-label="Estimate set" />
      ) : (
        <MinusOutline className="size-4 shrink-0" aria-hidden />
      )}
    </div>
  );
}
