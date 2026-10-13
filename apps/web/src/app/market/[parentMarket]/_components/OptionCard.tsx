import { EstimateSlider } from "@/features/predict/components/EstimateSlider";
import { useEstimate, useEstimateStore } from "@/features/predict/stores/estimateStore";
import { estimateDirection } from "@/features/predict/utils/estimates";
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
}

// REVISIT WHEN: the predict flow lands. A closed session should read "Trading has closed for this
// session." here; it is left open for now so past-date sessions on the fork can be worked with.
const LOCKED: Partial<Record<SessionStatus, string>> = {
  "setting-up": "Estimates open once every option is set up.",
};

export function OptionCard({
  option,
  parentMarket,
  status,
  marketEstimate,
  isMarketPending,
  isMarketUnavailable = false,
}: OptionCardProps) {
  const value = useEstimate(parentMarket, option.market);
  const setEstimate = useEstimateStore((state) => state.setEstimate);
  const clearEstimate = useEstimateStore((state) => state.clearEstimate);

  const isSelected =
    value !== undefined && marketEstimate !== undefined && estimateDirection(value, marketEstimate) !== null;

  return (
    <Disclosure
      className="bg-fs-surface-sunken w-full hover:shadow-md"
      title={<TitleRow option={option} isSelected={isSelected} />}
    >
      <Body option={option}>
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
      </Body>
    </Disclosure>
  );
}

function TitleRow({ option, isSelected }: { option: SessionOption; isSelected: boolean }) {
  return (
    <div className="flex flex-1 flex-wrap items-center justify-between gap-4">
      <div className="flex max-w-full grow basis-[70%] flex-wrap gap-2 md:min-w-75">
        <div className="flex min-w-0 items-center gap-2">
          <span className="size-2 flex-none rounded-full" style={{ backgroundColor: option.color }} aria-hidden />
          <h3 className="text-fs-text-primary min-w-0 text-left font-semibold wrap-break-word">{option.name}</h3>
        </div>
      </div>
      {isSelected ? (
        <CheckCircle className="size-4 shrink-0" role="img" aria-label="Estimate set" />
      ) : (
        <MinusOutline className="size-4 shrink-0" aria-hidden />
      )}
    </div>
  );
}

function Body({ option, children }: { option: SessionOption; children: React.ReactNode }) {
  return (
    <div className="flex w-full flex-col">
      <div className="pt-8 pb-4">{children}</div>
      <Disclosure buttonClassName="bg-fs-surface-sunken" title={<p className="w-fit text-center text-base">Details</p>}>
        <div className="flex w-full min-w-0 flex-col gap-3">
          <p className="type-caption text-fs-text-secondary text-pretty">{option.question}</p>
          <DisplayBlocks blocks={option.blocks} />
        </div>
      </Disclosure>
    </div>
  );
}
