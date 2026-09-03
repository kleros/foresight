import { Accordion, CustomAccordion, Slider } from "@kleros/ui-components-library";
import clsx from "clsx";

import { DisplayBlocks } from "@/features/sessions/components/DisplayBlocks";
import type { SessionOption } from "@/features/sessions/types";

import MinusOutline from "@/assets/svg/minus-outline.svg";

import { formatEstimate } from "@/utils/formatEstimate";

export function OptionCard({ option }: { option: SessionOption }) {
  return (
    <CustomAccordion
      aria-label={option.name}
      className={clsx(
        "bg-fs-surface-sunken flex h-auto w-full max-w-full flex-col gap-4",
        "hover:shadow-md [&>div]:my-0",
      )}
      items={[{ title: <TitleRow option={option} />, body: <Body option={option} /> }]}
    />
  );
}

function TitleRow({ option }: { option: SessionOption }) {
  return (
    <div className="flex flex-1 flex-wrap items-center justify-between gap-4">
      <div className="flex max-w-full grow basis-[70%] flex-wrap gap-2 md:min-w-75">
        <div className="flex min-w-0 items-center gap-2">
          <span className="size-2 flex-none rounded-full" style={{ backgroundColor: option.color }} aria-hidden />
          <h3 className="text-fs-text-primary min-w-0 text-left font-semibold wrap-break-word">{option.name}</h3>
        </div>
      </div>
      <MinusOutline className="size-4 shrink-0" />
    </div>
  );
}

function Body({ option }: { option: SessionOption }) {
  const hasScale = option.upperBound > option.lowerBound;

  return (
    <div className="flex w-full flex-col">
      <div className="pt-8 pb-4">
        {hasScale ? (
          <>
            <Slider
              className={clsx("w-full", "[&_#slider-label]:text-fs-text-primary! [&_#slider-label]:font-semibold")}
              aria-label={`Your estimate for ${option.name}`}
              minValue={option.lowerBound}
              maxValue={option.upperBound}
              defaultValue={(option.lowerBound + option.upperBound) / 2}
              step={(option.upperBound - option.lowerBound) / 100}
              leftLabel={formatEstimate(option.lowerBound, option.unit)}
              rightLabel={formatEstimate(option.upperBound, option.unit)}
              formatter={(value) => formatEstimate(value, option.unit)}
              callback={() => {}}
              isDisabled
            />
            <p className="type-caption text-fs-text-secondary mt-2">Setting estimates is not available yet.</p>
          </>
        ) : (
          <p className="type-caption text-fs-text-secondary">The scale for this option could not be read.</p>
        )}
      </div>
      <Accordion
        className={clsx(
          "w-full max-w-full",
          "[&_#expand-button]:bg-fs-surface-sunken [&_#expand-button_p]:font-normal",
        )}
        items={[
          {
            title: "Details",
            body: (
              <div className="flex w-full min-w-0 flex-col gap-3">
                <p className="type-caption text-fs-text-secondary text-pretty">{option.question}</p>
                <DisplayBlocks blocks={option.blocks} />
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
