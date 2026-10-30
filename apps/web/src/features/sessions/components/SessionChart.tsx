"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

import { createChart, type ISeriesApi, LineSeries, LineStyle, type UTCTimestamp } from "lightweight-charts";
import { useTheme } from "next-themes";

import { cn } from "@/utils/cn";
import { formatEstimate } from "@/utils/formatEstimate";

import type { SessionChartData } from "../types";
import { SessionChartLegend } from "./SessionChartLegend";
import { shortenName, withAlpha } from "../utils/chartDisplay";
import { buildChartSeries, chartEndTime } from "../utils/chartSeries";

interface ISessionChart {
  data: SessionChartData;
  /** Unix seconds. */
  startTime: number;
  endTime: number | null;
  /** The creator's plural noun, already lowercased. */
  noun: string;
}

export const SessionChart: React.FC<ISessionChart> = ({ data, startTime, endTime, noun }) => {
  const { theme } = useTheme();

  const keys = useMemo(() => data.map(({ option }) => option.market), [data]);

  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set(keys));

  React.useEffect(() => {
    setVisibleKeys(new Set(keys));
  }, [keys]);

  const handleToggle = (key: string) => {
    setVisibleKeys((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(key)) {
        newSet.delete(key);
      } else {
        newSet.add(key);
      }
      return newSet;
    });
  };

  const unit = useMemo(() => {
    const units = new Set(data.map(({ option }) => option.unit));
    return units.size === 1 ? (data[0]?.option.unit ?? null) : null;
  }, [data]);

  const accentColor = useMemo(() => {
    if (theme === "light") return "#999";
    else return "#BECCE5";
  }, [theme]);

  const gridLinesColor = useMemo(() => {
    if (theme === "light") return "#e5e5e5";
    else return "#392C74";
  }, [theme]);

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const seriesRefMap = useRef<Record<string, ISeriesApi<"Line">>>({});
  const seriesColorsRef = useRef<Record<string, string>>({});
  const seriesTitlesRef = useRef<Record<string, string>>({});
  const seriesOrderRef = useRef<Record<string, number>>({});
  const hoveredKeyRef = useRef<string | null>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const applySeriesHighlight = React.useCallback((key: string | null) => {
    const map = seriesRefMap.current;
    const colors = seriesColorsRef.current;
    const orders = seriesOrderRef.current;
    const isResetting = key === null;

    Object.entries(map).forEach(([name, s]) => {
      const baseColor = colors[name];
      if (!baseColor) return;

      const isHovered = name === key;
      s.applyOptions({
        lineWidth: isResetting ? 2 : isHovered ? 3 : 1,
        color: isResetting || isHovered ? baseColor : withAlpha(baseColor, 0.2),
        title: isHovered ? (seriesTitlesRef.current[name] ?? name) : "",
        lastValueVisible: isHovered,
        priceLineVisible: isHovered,
        priceLineStyle: LineStyle.Dashed,
      });
      s.setSeriesOrder(isHovered ? 999 : (orders[name] ?? 0));
    });
  }, []);

  const handleHover = React.useCallback(
    (key: string | null) => {
      hoveredKeyRef.current = key;
      setHoveredKey(key);
      applySeriesHighlight(key);
    },
    [applySeriesHighlight],
  );

  const series = useMemo(() => {
    if (!data.length) return [];

    return buildChartSeries(data, startTime, chartEndTime(data, endTime, Date.now() / 1000));
  }, [data, startTime, endTime]);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const handleResize = () => {
      chart.applyOptions({ width: chartContainerRef?.current?.clientWidth });
    };

    const chart = createChart(chartContainerRef?.current, {
      layout: {
        background: {
          color: "transparent",
        },
        textColor: accentColor,
      },
      width: chartContainerRef?.current?.clientWidth,
      height: chartContainerRef?.current?.clientHeight ?? 400,
      autoSize: true,
      rightPriceScale: {
        borderVisible: false,
        visible: true,
        ensureEdgeTickMarksVisible: true,
        minimumWidth: 52,
      },
      localization: {
        priceFormatter: (val: number) => formatEstimate(val, unit),
      },
      leftPriceScale: {
        borderVisible: false,
        visible: false,
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        rightOffset: 25,
      },
      grid: {
        vertLines: {
          color: gridLinesColor,
          style: LineStyle.SparseDotted,
        },
        horzLines: {
          color: gridLinesColor,
          style: LineStyle.SparseDotted,
        },
      },
    });
    chart.timeScale().fitContent();

    seriesRefMap.current = {};
    seriesColorsRef.current = {};
    seriesTitlesRef.current = {};
    seriesOrderRef.current = {};
    const visibleSeries = series
      .filter(({ option }) => visibleKeys.has(option.market))
      .sort((a, b) => {
        const aValue = a.points.at(-1)?.value ?? 0;
        const bValue = b.points.at(-1)?.value ?? 0;
        if (aValue !== bValue) return aValue - bValue;
        return a.option.name.localeCompare(b.option.name);
      });

    visibleSeries.forEach(({ option, points }, orderIndex) => {
      const key = option.market;
      const lineSeries = chart.addSeries(LineSeries, {
        color: option.color,
        lineWidth: 2,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      lineSeries.setData(points.map(({ timestamp, value }) => ({ time: timestamp as UTCTimestamp, value })));
      lineSeries.setSeriesOrder(orderIndex);
      seriesRefMap.current[key] = lineSeries;
      seriesColorsRef.current[key] = option.color;
      seriesTitlesRef.current[key] = shortenName(option.name);
      seriesOrderRef.current[key] = orderIndex;
    });

    applySeriesHighlight(hoveredKeyRef.current);

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      seriesRefMap.current = {};
      seriesColorsRef.current = {};
      seriesTitlesRef.current = {};
      seriesOrderRef.current = {};
      chart.remove();
    };
  }, [series, accentColor, visibleKeys, gridLinesColor, unit, applySeriesHighlight]);

  return (
    <div className="mt-6 flex size-full flex-col">
      <h2 className="text-klerosUIComponentsPrimaryText text-base font-semibold">Market estimates</h2>
      <div className="flex flex-col gap-2 md:h-100 md:flex-row">
        <div className="h-70 min-w-0 md:h-full md:min-h-0 md:flex-1">
          <div ref={chartContainerRef} className="size-full" />
        </div>
        <div
          className={cn(
            "bg-klerosUIComponentsWhiteBackground rounded-base flex min-h-0 flex-col",
            "overflow-hidden p-2 max-md:h-32 md:h-full md:w-44 md:shrink-0",
          )}
        >
          <SessionChartLegend
            data={data}
            noun={noun}
            visibleKeys={visibleKeys}
            hoveredKey={hoveredKey}
            onToggle={handleToggle}
            onHover={handleHover}
          />
        </div>
      </div>
    </div>
  );
};
