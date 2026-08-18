"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Tracks which wizard entry the reader is on. An entry takes over once its
 * heading passes a focal line; hysteresis keeps a section boundary sitting
 * exactly on that line from oscillating between two entries.
 */
const FOCAL_OFFSET = 260;
const GRACE = 24;
/** A click drives the index directly; don't let the observer fight that scroll. */
const SETTLE_MS = 700;

export function useScrollSpy(elementIds: string[]) {
  const [index, setIndex] = useState(0);
  const settleUntil = useRef(0);
  const indexRef = useRef(0);

  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  useEffect(() => {
    let frame = 0;
    const sync = () => {
      frame = 0;
      if (Date.now() < settleUntil.current) return;
      let next = 0;
      elementIds.forEach((id, i) => {
        const el = document.getElementById(id);
        if (!el) return;
        const top = el.getBoundingClientRect().top - FOCAL_OFFSET;
        const limit = i > indexRef.current ? -GRACE : GRACE;
        if (top <= limit) next = i;
      });
      setIndex((prev) => (prev === next ? prev : next));
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(sync);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    sync();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [elementIds]);

  const goTo = useCallback((targetIndex: number, elementId: string, block: ScrollLogicalPosition = "start") => {
    const el = document.getElementById(elementId);
    settleUntil.current = Date.now() + SETTLE_MS;
    setIndex(targetIndex);
    el?.scrollIntoView({ behavior: "smooth", block });
  }, []);

  return { index, goTo };
}
