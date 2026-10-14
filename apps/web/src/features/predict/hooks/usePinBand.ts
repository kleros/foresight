"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { pinOverlapShare } from "../utils/estimates";

interface PinGeometry {
  /** Share of the scale within which the pin drops so it never covers the thumb's label; 0 until measured. */
  band: number;
  /** Which scale bound a dropped pin's chip would sit on, at `marketShare` along the track. */
  covers: { lower: boolean; upper: boolean };
}

const NONE: PinGeometry = { band: 0, covers: { lower: false, upper: false } };

/**
 * Measures the slider track, the market pin's chip, the thumb's label and the bound labels
 * (`[data-bound]`), for the pin's placement. `marketShare` is the market's place on the track, 0 to 1.
 */
export function usePinBand(thumbValue: number, marketShare: number | undefined) {
  const track = useRef<HTMLDivElement>(null);
  const chip = useRef<HTMLSpanElement>(null);
  const [geometry, setGeometry] = useState<PinGeometry>(NONE);

  const measure = useCallback(() => {
    const root = track.current;
    if (!root) return;
    const width = root.clientWidth;
    const chipWidth = chip.current?.offsetWidth ?? 0;
    const widthOf = (selector: string) => root.querySelector(selector)?.getBoundingClientRect().width ?? 0;
    const at = (marketShare ?? 0) * width;
    const next: PinGeometry = {
      band: pinOverlapShare({ track: width, chip: chipWidth, label: widthOf("#slider-label") }),
      covers: {
        lower: width > 0 && at - chipWidth / 2 < widthOf('[data-bound="lower"]'),
        upper: width > 0 && at + chipWidth / 2 > width - widthOf('[data-bound="upper"]'),
      },
    };
    setGeometry((current) =>
      current.band === next.band &&
      current.covers.lower === next.covers.lower &&
      current.covers.upper === next.covers.upper
        ? current
        : next,
    );
  }, [marketShare]);

  // the label's text, and so its width, follows the thumb
  useEffect(measure, [measure, thumbValue]);

  useEffect(() => {
    const root = track.current;
    if (!root) return;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [measure]);

  return { track, chip, ...geometry };
}
