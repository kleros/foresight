"use client";

import { useEffect, useState } from "react";

/** setTimeout fires at once past 2^31 - 1 ms, so a far close is waited out in steps. */
const LONGEST_TIMEOUT_MS = 2 ** 31 - 1;

/** Renders the caller again the moment `closesAt` passes, so a status read from the clock flips on time. */
export function useRenderAtClose(closesAt: Date | null | undefined): void {
  const [ticks, setTicks] = useState(0);
  const at = closesAt?.getTime();

  useEffect(() => {
    if (at === undefined) return;
    const left = at - Date.now();
    if (left < 0) return;
    const timer = setTimeout(() => setTicks((count) => count + 1), Math.min(left + 1, LONGEST_TIMEOUT_MS));
    return () => clearTimeout(timer);
  }, [at, ticks]);
}
