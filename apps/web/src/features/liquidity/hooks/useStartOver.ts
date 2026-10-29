"use client";

import { useEffect, useState } from "react";

import type { LiquidityRun } from "./useLiquidityRun";

/** Start over for a stopped run: forgets it, or, while it holds a send, asks first and then discards it. */
export function useStartOver(run: LiquidityRun) {
  const [asked, setAsked] = useState(false);
  const holdsSend = run.progress?.holdsSend === true;
  // a press answers the stop it was made on, so a later hold asks again
  useEffect(() => {
    if (!holdsSend) setAsked(false);
  }, [holdsSend]);
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
