import { useMemo, useState } from "react";

import { Searchbar } from "@kleros/ui-components-library";
import clsx from "clsx";

import { ScrollFade } from "@/components/ui/ScrollFade";

import { getReadableTextColor } from "@/utils/branchColor";
import { cn } from "@/utils/cn";
import { formatEstimate } from "@/utils/formatEstimate";

import type { SessionChartData } from "../types";
import { shortenName } from "../utils/chartDisplay";

interface ISessionChartLegend {
  data: SessionChartData;
  /** The creator's plural noun, already lowercased. */
  noun: string;
  visibleKeys: Set<string>;
  hoveredKey?: string | null;
  onToggle: (key: string) => void;
  onHover?: (key: string | null) => void;
}

export const SessionChartLegend: React.FC<ISessionChartLegend> = ({
  data,
  noun,
  visibleKeys,
  hoveredKey = null,
  onToggle,
  onHover,
}) => {
  const [searchQuery, setSearchQuery] = useState("");

  const sortedSeries = useMemo(() => {
    return [...data].sort((a, b) => {
      const aValue = a.points.at(-1)?.value ?? a.option.lowerBound;
      const bValue = b.points.at(-1)?.value ?? b.option.lowerBound;
      if (aValue !== bValue) return bValue - aValue;
      return a.option.name.localeCompare(b.option.name);
    });
  }, [data]);

  const filteredSeries = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return sortedSeries;

    return sortedSeries.filter(({ option }) => option.name.toLowerCase().includes(query));
  }, [searchQuery, sortedSeries]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-1 overflow-hidden md:gap-2">
      <Searchbar
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder={`Search ${noun}`}
        aria-label={`Search ${noun}`}
        className={cn(
          "w-full shrink-0",
          "[&>div:first-child]:h-7!",
          "[&>div:first-child]:flex [&>div:first-child]:items-center",
          "[&>div:first-child_svg]:top-1/2! [&>div:first-child_svg]:left-2.5!",
          "[&>div:first-child_svg]:size-3! [&>div:first-child_svg]:-translate-y-1/2!",
        )}
        inputProps={{
          className: cn(
            "h-7! min-h-0! py-0! pl-8! pr-2!",
            "text-[10px]! leading-none!",
            "placeholder:text-[10px]! placeholder:leading-none!",
          ),
        }}
      />
      <div className="min-h-0 flex-1 overflow-hidden" onMouseLeave={() => onHover?.(null)}>
        <ScrollFade className="h-full min-h-0">
          <div className="grid min-w-0 grid-cols-2 gap-1 sm:grid-cols-3 md:grid-cols-1">
            {filteredSeries.length === 0 ? (
              <p className="text-klerosUIComponentsSecondaryText px-0.5 text-[10px]">No {noun} found</p>
            ) : null}
            {filteredSeries.map(({ option, points }) => {
              const key = option.market;
              const isVisible = visibleKeys.has(key);
              const isHovered = hoveredKey === key;
              const value = formatEstimate(points.at(-1)?.value ?? option.lowerBound, option.unit);
              const color = getReadableTextColor(option.color);

              return (
                <button
                  key={key}
                  type="button"
                  title={`${option.name} ${value}`}
                  onClick={() => onToggle(key)}
                  onMouseEnter={() => onHover?.(key)}
                  className={cn(
                    "rounded-base h-fit w-full min-w-0 cursor-pointer overflow-hidden px-1 py-0.5 text-left",
                    "transition-[opacity,transform,box-shadow]",
                    isVisible ? "opacity-100" : "opacity-40",
                    isHovered && "ring-1 ring-white/80",
                  )}
                  style={{ backgroundColor: option.color }}
                >
                  <p className="truncate text-[10px] leading-tight" style={{ color }}>
                    {shortenName(option.name)}
                    <span className="mx-0.5" style={{ color }}>
                      |
                    </span>
                    {value}
                  </p>
                </button>
              );
            })}
          </div>
        </ScrollFade>
      </div>
      <button
        type="button"
        onClick={() => {
          const originalSize = visibleKeys.size;
          data.forEach(({ option }) => {
            if (originalSize === 0 || (originalSize > 0 && visibleKeys.has(option.market))) onToggle(option.market);
          });
        }}
        className={clsx(
          "text-klerosUIComponentsSecondaryText hover:text-klerosUIComponentsPrimaryText",
          "shrink-0 cursor-pointer text-left text-[10px] transition-colors",
        )}
      >
        {visibleKeys.size > 0 ? "Clear all" : "Show all"}
      </button>
    </div>
  );
};
