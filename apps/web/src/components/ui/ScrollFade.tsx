"use client";
import React, { useEffect, useRef, useState } from "react";

import clsx from "clsx";

import ArrowDown from "@/assets/svg/long-arrow-down.svg";

type ScrollFadeProps = {
  children: React.ReactNode;
  className?: string;
  fadeSize?: number; // px
  /** Said at the foot while there is more to scroll to. */
  cue?: string;
};

/**
 * Self-contained scrollable wrapper with automatic top/bottom fades.
 * Manages its own overflow and shrink behavior; requires a bounded height.
 */
export const ScrollFade: React.FC<ScrollFadeProps> = ({ children, className, fadeSize = 24, cue }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [showTop, setShowTop] = useState(false);
  const [showBottom, setShowBottom] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const EPSILON = 2; // px tolerance for sub-pixel / animation noise

    const update = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;

      const maxScrollable = scrollHeight - clientHeight;
      const hasOverflow = maxScrollable > EPSILON;

      const atTop = scrollTop <= EPSILON;
      const atBottom = scrollTop >= maxScrollable - EPSILON;

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
  }, []);

  return (
    <div className={clsx("relative min-h-0", "flex flex-1 flex-col", className)}>
      {/* Top fade */}
      {showTop && (
        <div
          className={clsx(
            "pointer-events-none absolute top-0 right-0 left-0 z-10",
            "from-fs-surface bg-linear-to-b to-transparent",
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
            "from-fs-surface bg-linear-to-t to-transparent",
          )}
          style={{
            height: fadeSize,
          }}
        />
      )}

      {cue ? (
        <span
          data-testid="more-below"
          aria-hidden
          className={clsx(
            "pointer-events-none absolute right-0 bottom-0 left-0 z-20 flex h-4 items-center justify-center gap-1",
            "border-fs-border bg-fs-surface text-fs-text-secondary type-caption border-t",
            "transition-opacity duration-(--fs-dur-enter) ease-(--fs-ease-enter)",
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
