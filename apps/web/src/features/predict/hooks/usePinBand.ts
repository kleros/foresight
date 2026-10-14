"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { stickClearShare } from "../utils/estimates";

interface PinGeometry {
  /** Share of the scale within which the pin's stick would cross the thumb's number; 0 until measured. */
  band: number;
  /** The chip's offset from the pin's point in px, keeping it on the track; undefined until measured. */
  chipShift: number | undefined;
  /** Which scale bound a dropped chip sits on. */
  covers: { lower: boolean; upper: boolean };
}

const NONE: PinGeometry = { band: 0, chipShift: undefined, covers: { lower: false, upper: false } };

const same = (a: PinGeometry, b: PinGeometry) =>
  a.band === b.band &&
  a.chipShift === b.chipShift &&
  a.covers.lower === b.covers.lower &&
  a.covers.upper === b.covers.upper;

/**
 * Measures the slider track, the market pin's chip, the thumb's label and the bound labels
 * (`[data-bound]`) for the pin's placement. `marketShare` is the market's place on the track, 0 to 1.
 */
export function usePinBand(thumbValue: number, marketShare: number | undefined) {
  const track = useRef<HTMLDivElement>(null);
  const chip = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState<PinGeometry>(NONE);

  const measure = useCallback(() => {
    const root = track.current;
    if (!root) return;
    const width = root.clientWidth;
    const chipWidth = chip.current?.offsetWidth ?? 0;
    if (width === 0 || chipWidth === 0) return setGeometry((current) => (same(current, NONE) ? current : NONE));

    const widthOf = (selector: string) => root.querySelector(selector)?.getBoundingClientRect().width ?? 0;
    const at = (marketShare ?? 0) * width;
    const left = Math.min(Math.max(at - chipWidth / 2, 0), width - chipWidth);
    const next: PinGeometry = {
      band: stickClearShare({ track: width, label: widthOf("#slider-label") }),
      chipShift: left - at,
      covers: {
        lower: left < widthOf('[data-bound="lower"]'),
        upper: left + chipWidth > width - widthOf('[data-bound="upper"]'),
      },
    };
    setGeometry((current) => (same(current, next) ? current : next));
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
