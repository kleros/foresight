"use client";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

import clsx from "clsx";

import ArrowDown from "@/assets/svg/long-arrow-down.svg";

type ScrollFadeProps = {
  children: React.ReactNode;
  className?: string;
  fadeSize?: number; // px
  /** Said at the foot while there is more to scroll to, on a strip of its own below the scroll area. */
  cue?: string;
  /** The least overflow, in px, that raises the fades and the cue; by default a 16px line, as less is usually padding. */
  minOverflow?: number;
  /** The fades' colour, as a `from-*` class: the surface the scroll area sits on. */
  fadeFrom?: string;
};

// measured before paint, so the cue's strip is laid out by the next frame, when a child may scroll the area
const useMeasureEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Self-contained scrollable wrapper with automatic top/bottom fades.
 * Manages its own overflow and shrink behavior; requires a bounded height.
 */
export const ScrollFade: React.FC<ScrollFadeProps> = ({
  children,
  className,
  fadeSize = 24,
  cue,
  minOverflow = 16,
  fadeFrom = "from-fs-surface",
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const cueRef = useRef<HTMLSpanElement>(null);
  const [showTop, setShowTop] = useState(false);
  const [showBottom, setShowBottom] = useState(false);
  const [hasOverflow, setHasOverflow] = useState(false);

  useMeasureEffect(() => {
    const el = ref.current;
    if (!el) return;
    const EPSILON = 2; // px tolerance for sub-pixel / animation noise

    const update = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;

      const maxScrollable = scrollHeight - clientHeight;
      // the cue's strip takes its height from the scroll area while it is held open
      const strip = cueRef.current?.offsetHeight ?? 0;
      const hasOverflow = maxScrollable >= Math.max(minOverflow, 1) + strip;

      // the tolerance never swallows the whole of a 1-2px overflow
      const tolerance = Math.min(EPSILON, maxScrollable - 1);
      const atTop = scrollTop <= tolerance;
      const atBottom = scrollTop >= maxScrollable - tolerance;

      setHasOverflow(hasOverflow);
      setShowTop(hasOverflow && !atTop);
      setShowBottom(hasOverflow && !atBottom);
    };

    update();

    el.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    // Content can grow without a scroll or a window resize.
    const observer = new ResizeObserver(update);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);

    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      observer.disconnect();
    };
  }, [minOverflow]);

  return (
    <div className={clsx("relative min-h-0", "flex flex-1 flex-col", className)}>
      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* Top fade */}
        {showTop && (
          <div
            className={clsx(
              "pointer-events-none absolute top-0 right-0 left-0 z-10",
              fadeFrom,
              "bg-linear-to-b to-transparent",
            )}
            style={{
              height: fadeSize,
            }}
          />
        )}

        {/* Scroll container */}
        <div
          ref={ref}
          className={clsx(
            "w-full overflow-hidden overflow-y-auto",
            "[-ms-overflow-style:none] scrollbar-none [&::-webkit-scrollbar]:hidden",
          )}
        >
          {children}
        </div>

        {/* Bottom fade */}
        {showBottom && (
          <div
            className={clsx(
              "pointer-events-none absolute right-0 bottom-0 left-0 z-10",
              fadeFrom,
              "bg-linear-to-t to-transparent",
            )}
            style={{
              height: fadeSize,
            }}
          />
        )}
      </div>

      {cue ? (
        <span
          ref={cueRef}
          data-testid="more-below"
          aria-hidden
          className={clsx(
            "pointer-events-none h-4 shrink-0 items-center justify-center gap-1",
            "border-fs-border bg-fs-surface text-fs-text-secondary type-caption border-t",
            "transition-opacity duration-(--fs-dur-enter) ease-(--fs-ease-enter)",
            hasOverflow ? "flex" : "hidden",
            showBottom ? "opacity-100" : "opacity-0",
          )}
        >
          <ArrowDown className="size-2.5 [&_path]:fill-current" />
          {cue}
        </span>
      ) : null}
    </div>
  );
};
