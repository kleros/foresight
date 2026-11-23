import type { FlowRunStore } from "@foresight/tx-orchestrator";

import { createRunStore } from "@/lib/flowRunStore";

import { mayStillLand } from "./run";

/** This browser's store of wallet redeem runs; a run that may still land stays past its expiry (R7). */
export const redeemRunStore = (): FlowRunStore => createRunStore(mayStillLand);
