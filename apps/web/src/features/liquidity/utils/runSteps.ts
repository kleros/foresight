import type { PopupStatusLine } from "@/components/ui/StatusGlyph";
import type { TimelineStep } from "@/components/ui/StepsTimeline";

import { MAY_LAND, type LiquidityFailureReason, type LiquidityProgress, type LiquidityProgressRow } from "../types";

/** A row the popup lists before a run: its id as the run's rows name it, and its transactions. */
export interface PlannedRow {
  id: string;
  signatures: number;
}

const FAILURE_COPY: Record<LiquidityFailureReason, string> = {
  rejected: "You declined in the wallet. Nothing more was signed.",
  cancelled: "The transaction was cancelled.",
  reverted: "A transaction reverted on chain.",
  rpc: "The network did not answer. Try again in a moment.",
  unknown: "Something went wrong.",
  unlisted: "A transaction did not match what was reviewed, so it was not sent.",
  closed: "The session has closed, so liquidity can't be added.",
  "wrong-wallet": "Connect the wallet that started this run.",
  "wrong-chain": "Switch the wallet to Gnosis.",
  pending: "The wallet has a transaction waiting. Wait for it to land first.",
  held: "A wallet prompt from before may still be open. Answer it, or wait before signing again.",
  wallet: "The wallet turned the request down before asking you. Check the wallet, then try again.",
  storage: "This browser could not save the run, so nothing was sent.",
  "batch-unknown": "The wallet cannot say whether its batch landed, so it is not sent again.",
  "batch-failed": "The wallet's batch did not land.",
  "gas-reserve": "That would leave too little xDAI for gas.",
};

const STAGE_COPY: Partial<Record<LiquidityProgress["stage"], PopupStatusLine>> = {
  review: { text: "An earlier liquidity run of this wallet is unfinished. Resume it to finish.", tone: "warning" },
  moved: { text: "A pool moved since you reviewed it, so nothing more was signed.", tone: "warning" },
  complete: { text: "Done. Your liquidity is updated.", tone: "neutral" },
};

/** Shown before Start over lets go of a send the wallet may still be asking about. */
export const START_OVER_WARNING =
  "Reject the open prompt in your wallet first. Anything that already went through stays done, and its tokens stay in your wallet.";

const signatures = (count: number) => `${count} ${count === 1 ? "signature" : "signatures"}`;

/** What the run is doing or why it stopped, naming the signature it is on; null before a run. */
export function runStatus(progress: LiquidityProgress | null): PopupStatusLine | null {
  if (!progress) return null;
  if (progress.failure) {
    return {
      text: FAILURE_COPY[progress.failure.reason],
      tone: MAY_LAND.has(progress.failure.reason) ? "warning" : "error",
    };
  }
  const staged = STAGE_COPY[progress.stage];
  if (staged) return staged;
  if (progress.stage !== "signing" && progress.stage !== "confirming") return null;
  const at = progress.signature;
  if (!at) {
    return progress.stage === "signing"
      ? { text: "Checking the chain before you sign.", tone: "neutral", waiting: true }
      : { text: "Checking the run's last transaction.", tone: "neutral", waiting: true };
  }
  const which = at.total === 1 ? "" : ` ${at.position} of ${at.total}`;
  switch (at.status) {
    case "awaiting-signature":
      return {
        text: at.total === 1 ? "Confirm in your wallet." : `Signature${which}. Confirm in your wallet.`,
        tone: "neutral",
      };
    case "submitted":
      return {
        text: at.total === 1 ? "Waiting for the transaction to confirm." : `Waiting for signature${which} to confirm.`,
        tone: "neutral",
        waiting: true,
      };
    case "building":
      return { text: `Checking the chain before signature${which}.`, tone: "neutral", waiting: true };
  }
}

/** What the run waits on: the wallet, the chain to mine, or its own checks of the chain. */
function waitingOn(progress: LiquidityProgress | null): string {
  switch (progress?.signature?.status) {
    case "awaiting-signature":
      return "Confirm in your wallet";
    case "submitted":
      return "Confirming…";
    default:
      return "Checking…";
  }
}

/** The busy button's words while a run goes. */
export function busyText(progress: LiquidityProgress | null): string | undefined {
  if (progress?.stage !== "signing" && progress?.stage !== "confirming") return undefined;
  return waitingOn(progress);
}

function subtitle(row: LiquidityProgressRow, progress: LiquidityProgress | null): string {
  const { done, total } = row.signatures;
  if (row.view === "running") {
    const wait = waitingOn(progress);
    return progress?.atomic || total === 1 ? wait : `${done + 1} of ${total} · ${wait}`;
  }
  // a batch signs every row at once
  if (progress?.atomic) return "In one batch";
  if (row.view === "failed" && done > 0) return `${done} of ${total} went through`;
  return signatures(total);
}

/**
 * The popup's step rows for a `kind` of run: the run's own rows while it is of that kind, else the planned rows,
 * each titled by `title(id)`.
 */
export function runSteps(args: {
  kind: NonNullable<LiquidityProgress["kind"]>;
  planned: PlannedRow[];
  progress: LiquidityProgress | null;
  title: (id: string) => string;
}): TimelineStep[] {
  const { kind, planned, progress, title } = args;
  const rows: LiquidityProgressRow[] =
    progress?.kind === kind && progress.rows.length > 0
      ? progress.rows
      : planned.map(({ id, signatures: total }) => ({ id, view: "idle", signatures: { done: 0, total } }));
  return rows.map((row) => ({
    key: row.id,
    title: title(row.id),
    subtitle: subtitle(row, progress?.kind === kind ? progress : null),
    view: row.view,
  }));
}
