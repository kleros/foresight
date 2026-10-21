import { useEffect, useLayoutEffect, useRef, useState, type AnimationEvent } from "react";

const useMeasureEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** `entering` rises with a fresh live Predict, `leaving` sinks as it goes; neither replays on scroll. */
type Phase = "idle" | "entering" | "leaving";

/** Where the dock's top sits in the page's flow, whether or not it is pinned: under its previous sibling. */
function flowTop(dock: HTMLElement): number {
  const parent = dock.parentElement!;
  const style = getComputedStyle(parent);
  const previous = dock.previousElementSibling;
  return previous
    ? previous.getBoundingClientRect().bottom + (parseFloat(style.rowGap) || 0)
    : parent.getBoundingClientRect().top + parseFloat(style.paddingTop);
}

/** The dock's height docked into the page, read off a hidden copy so a pinned dock need not unpin to be measured. */
function dockedHeight(dock: HTMLElement): number {
  const copy = dock.cloneNode(true) as HTMLElement;
  for (const name of ["data-stuck", "data-entering", "data-leaving", "style"]) copy.removeAttribute(name);
  Object.assign(copy.style, { position: "absolute", visibility: "hidden", width: `${dock.offsetWidth}px` });
  dock.after(copy);
  const height = copy.offsetHeight;
  copy.remove();
  return height;
}

/**
 * The phone dock around the Predict card: pinned to the bottom edge while Predict is live and the card's own
 * place is below the fold, docked back into the page once the visitor reaches it.
 */
export function usePredictDock(isLive: boolean, content: string) {
  const ref = useRef<HTMLDivElement>(null);
  const docked = useRef(0);
  const remeasure = useRef<() => void>(undefined);
  const [isStuck, setIsStuck] = useState(false);
  // the card's height in the page, measured docked and held while pinned, so the page keeps one length
  const [height, setHeight] = useState<number>();
  const [phase, setPhase] = useState<Phase>("idle");
  const [wasLive, setWasLive] = useState(isLive);
  if (wasLive !== isLive) {
    setWasLive(isLive);
    setPhase(isLive ? "entering" : isStuck ? "leaving" : "idle");
  }

  useMeasureEffect(() => {
    if (!isLive) {
      if (phase !== "leaving") setIsStuck(false);
      return;
    }
    let frame = 0;
    let isResized = false;
    const check = (measure: boolean) => {
      frame = 0;
      const dock = ref.current;
      if (!dock) return;
      // the dock pins only below md; its computed position says whether it does at this width
      if (getComputedStyle(dock).position !== "sticky") {
        setIsStuck(false);
        return;
      }
      if (measure) {
        docked.current = dockedHeight(dock);
        setHeight(docked.current);
      }
      const stuck = flowTop(dock) + docked.current > window.innerHeight + 0.5;
      setIsStuck(stuck);
      if (!stuck) setPhase((current) => (current === "entering" ? "idle" : current));
    };
    const schedule = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          check(isResized);
          isResized = false;
        });
    };
    const onResize = () => {
      isResized = true;
      schedule();
    };
    remeasure.current = () => check(true);
    check(true);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      remeasure.current = undefined;
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", onResize);
    };
  }, [isLive]);

  // what the card carries changed, and with it the height it takes docked
  useMeasureEffect(() => remeasure.current?.(), [content]);

  // React has no onAnimationCancel; a dock widened past md mid-exit drops its animation without an end
  useEffect(() => {
    const dock = ref.current;
    if (phase !== "leaving" || !dock) return;
    const settle = (event: Event) => {
      if (event.target !== dock) return;
      setIsStuck(false);
      setPhase("idle");
    };
    dock.addEventListener("animationcancel", settle);
    return () => dock.removeEventListener("animationcancel", settle);
  }, [phase]);

  const onAnimationEnd = (event: AnimationEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (phase === "leaving") setIsStuck(false);
    setPhase("idle");
  };

  return {
    ref,
    isDocked: isLive || phase === "leaving",
    isStuck,
    phase,
    // the pinned bar sits at the bottom of the card's own height
    style: isStuck && height !== undefined ? { minHeight: height } : undefined,
    onAnimationEnd,
  };
}
