"use client";

import { useState } from "react";

import type { LiquidityRun } from "./useLiquidityRun";

/** Start over for a stopped run: forgets it, or, while it holds a send, asks first and then discards it. */
export function useStartOver(run: LiquidityRun) {
  const [asked, setAsked] = useState(false);
  const holdsSend = run.progress?.holdsSend === true;
  return {
    /** The user pressed Start over on a run holding a send, and has not confirmed or gone back. */
    isAsking: asked && holdsSend,
    press: () => (holdsSend ? setAsked(true) : run.reset()),
    confirm: () => {
      setAsked(false);
      run.discard();
    },
    cancel: () => setAsked(false),
  };
}
