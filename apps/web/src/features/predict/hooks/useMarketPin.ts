"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

interface PinSizes {
  track: number;
  pill: number;
  chip: number;
  lower: number;
  upper: number;
}

const NONE: PinSizes = { track: 0, pill: 0, chip: 0, lower: 0, upper: 0 };

const same = (a: PinSizes, b: PinSizes) =>
  a.track === b.track && a.pill === b.pill && a.chip === b.chip && a.lower === b.lower && a.upper === b.upper;

/**
 * Measures the slider track, the value pill, the market's chip and the bound labels (`[data-bound]`)
 * after every render, and sets them only when one has changed. `ready` turns on a frame after the first measurement, so the pin's first placement does not animate.
 * While `holdPill` is on, the pill keeps the width it had, so an open field moves nothing.
 */
export function useMarketPin({ holdPill = false }: { holdPill?: boolean } = {}) {
  const track = useRef<HTMLDivElement>(null);
  const chip = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const holding = useRef(holdPill);
  const [sizes, setSizes] = useState<PinSizes>(NONE);
  const applied = useRef<PinSizes>(NONE);
  const [ready, setReady] = useState(false);

  // a dispatch from a layout effect re-renders even when its updater returns the same state
  const measure = () => {
    const root = track.current;
    if (!root) return;
    const widthOf = (selector: string) => root.querySelector(selector)?.getBoundingClientRect().width ?? 0;
    const last = applied.current;
    const next: PinSizes =
      root.clientWidth === 0
        ? NONE
        : {
            track: root.clientWidth,
            pill: holding.current && last.pill > 0 ? last.pill : (pill.current?.offsetWidth ?? 0),
            chip: chip.current?.offsetWidth ?? 0,
            lower: widthOf('[data-bound="lower"]'),
            upper: widthOf('[data-bound="upper"]'),
          };
    if (same(last, next)) return;
    applied.current = next;
    setSizes(next);
  };

  // before the measure below, which the ResizeObserver also calls from its first render's closure
  useLayoutEffect(() => {
    holding.current = holdPill;
  });
  // the pill's text, and so its width, follows the thumb
  useLayoutEffect(measure);

  useEffect(() => {
    const root = track.current;
    if (!root) return;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    // a web font arriving resizes the chip and the labels, not the track
    document.fonts?.addEventListener("loadingdone", measure);
    return () => {
      observer.disconnect();
      document.fonts?.removeEventListener("loadingdone", measure);
    };
  }, []);

  const measured = sizes.track > 0;
  useEffect(() => {
    if (!measured) return setReady(false);
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, [measured]);

  return { track, chip, pill, sizes, ready };
}
