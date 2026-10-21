import type { Address } from "viem";

import { shortenAddress } from "@/utils/address";
import { FEE_ONLY_OUT_OF_FUNDS_COPY, OUT_OF_FUNDS_COPY } from "@/utils/txErrorText";

import { shownAmount, type Funding } from "./funding";
import { STEP_ID } from "../flow/stepIds";
import type { PredictProgress } from "../run/types";
import type { PayToken } from "../types";

export type StepView = "idle" | "running" | "done" | "inactive" | "failed";

export interface PredictStepRow {
  key: "wallet" | "funds" | "predict";
  title: string;
  subtitle: string;
  view: StepView;
}

export interface PredictSteps {
  rows: PredictStepRow[];
  /** Set once a run has stopped short, in words the visitor can act on; the row that stopped reads `failed`. */
  failure?: string;
  /** The stopped run's transaction was sent and may still confirm, so `failure` is a warning. */
  pending?: true;
  /** What the run is doing while it checks a sent transaction before going on. */
  note?: string;
  /** A run exists, so the line shown before one no longer applies. */
  started?: true;
  /** The routes are being priced before the run's first step, which no step row shows. */
  pricing?: true;
}

/** The credits swap has no quote or route, so a run spending credits cannot be planned. */
export const CREDITS_UNAVAILABLE = "Credits can't be spent right now. Untick them to predict with your own funds.";

/** The chain's own errors name gas and contracts, which the popup never shows. */
const FAILURE_COPY: Record<NonNullable<PredictProgress["failure"]>["reason"], string> = {
  rejected: "You declined in your wallet.",
  cancelled: "Cancelled or replaced in your wallet.",
  reverted: "The trade failed at these prices. Raise slippage in Settings and retry.",
  rpc: "The network did not answer.",
  unknown: "Something went wrong.",
  "no-route": "No trade found for these estimates. Try a larger amount.",
  "at-estimates": "Prices are already at your estimates. Nothing to trade.",
  quote: "Could not get prices. Try again shortly.",
  funds: OUT_OF_FUNDS_COPY,
  balance: "Trade wallet balance is lower than shown. Check the amount.",
  credits: CREDITS_UNAVAILABLE,
  "deposit-unconfirmed": "Your last transaction may still be confirming. Check your wallet.",
  pending: "A transaction from your wallet is still confirming. Try again once it lands.",
  "wrong-wallet": "Started from another wallet. Connect it to finish.",
  "wrong-chain": "Started on another network. Switch to it to finish.",
};

/** Once the credits are in the trade wallet the run is locked to them, so only waiting helps. */
const CREDITS_LOCKED_COPY = "Credits can't be spent right now. Try again shortly.";

/** A transaction is out there and nothing has said how it ended, so it is neither a success nor a failure. */
const PENDING_COPY = "Sent, not confirmed yet.";

const RECONCILING_COPY = "Checking your last transaction…";

/** Said by the summary row and the button while the routes are priced, and by a step quoting mid-run. */
export const CHECKING_PRICES = "Checking prices…";

const STAGE_COPY: Partial<Record<PredictProgress["stage"], string>> = {
  quoting: CHECKING_PRICES,
  signing: "Confirm in your wallet",
  confirming: "Confirming…",
};

/** What the funds step adds, frozen when a run starts so a refreshed balance does not rewrite it. */
export interface FundsToAdd {
  /** In the token the visitor pays with. */
  toAdd: bigint;
  symbol: string;
  decimals: number;
  /** Credits moved from the visitor's wallet to the trade wallet; absent when none move. */
  credits?: bigint;
}

/** An xDAI payment adds its deposit; a collateral payment adds `toAdd` itself. */
export function fundsToAdd(
  funding: Funding | null,
  pay: { id: PayToken; symbol: string; decimals: number },
  collateral: { symbol: string; decimals: number },
): FundsToAdd {
  const toAdd = funding?.toAdd ?? 0n;
  const moved = (funding?.credits ?? []).reduce((sum, use) => sum + use.fromWallet, 0n);
  const credits = moved > 0n ? { credits: moved } : {};
  if (pay.id === "collateral") return { toAdd, ...collateral, ...credits };
  return {
    toAdd: funding?.deposit ?? 0n,
    symbol: pay.symbol,
    decimals: pay.decimals,
    ...credits,
  };
}

/**
 * The three rows of futarchy's predict timeline — trade wallet, funds, prediction — shown before
 * a run starts and filled in by the run's own steps once it does.
 */
export function predictSteps(
  args: FundsToAdd & {
    wallet: { address: Address; deployed: boolean } | null;
    progress: PredictProgress | null;
  },
): PredictSteps {
  const { wallet, toAdd, symbol, decimals, credits = 0n, progress } = args;
  // the driver reads a sent transaction's receipt under "confirming" with no step of its own running
  const reconciling =
    progress?.stage === "confirming" &&
    Boolean(progress.pendingHash) &&
    !progress.steps.some((step) => step.state === "running");
  const sentId = reconciling ? progress.steps.find((step) => step.state !== "success")?.id : undefined;
  const runSteps = (progress?.steps ?? []).map((step) =>
    step.id === sentId ? { ...step, state: "running" as const } : step,
  );
  const row = (id: string) => runSteps.find((step) => step.id === id);
  const halted = progress?.stage === "halted";

  const walletRow = row(STEP_ID.createExecutor);
  const walletReady = Boolean(wallet?.deployed) || walletRow?.state === "success";

  // the credits transfer and the deposit share the one funds row
  const fundsSteps = [row(STEP_ID.addCredits), row(STEP_ID.deposit)].filter((step) => step !== undefined);
  const fundsState =
    fundsSteps.length === 0
      ? undefined
      : fundsSteps.some((step) => step.state === "error")
        ? "error"
        : fundsSteps.some((step) => step.state === "running")
          ? "running"
          : fundsSteps.every((step) => step.state === "success")
            ? "success"
            : "pending";

  const batches = runSteps.filter((step) => step.id.startsWith("predict-"));
  const runningBatch = batches.findIndex((step) => step.state === "running");
  // the routes are priced before anything is signed, while no step of the run is going yet
  const checking = progress?.stage === "quoting" && !runSteps.some((step) => step.state === "running");
  const predictRunning = runningBatch >= 0;
  const stageCopy = progress ? (STAGE_COPY[progress.stage] ?? "") : "";
  const adding = [
    ...(credits > 0n ? [`${shownAmount(credits, 18)} credits`] : []),
    // the sDAI an xDAI deposit becomes is said under the amount and in Details
    ...(toAdd > 0n ? [`${shownAmount(toAdd, decimals)} ${symbol}`] : []),
  ].join(" + ");
  // only a batch quotes, so the steps before one say only what the wallet is waiting on
  const txWait = progress?.stage === "signing" || progress?.stage === "confirming" ? stageCopy : "";

  // the row whose step errored stopped the run; with none, nothing got past pricing.
  // A sent, unconfirmed transaction may still land, so its row is not crossed.
  const failedKey: PredictStepRow["key"] | undefined =
    halted && !progress.pendingHash
      ? walletRow?.state === "error"
        ? "wallet"
        : fundsState === "error"
          ? "funds"
          : "predict"
      : undefined;
  const partial =
    halted && progress.batchesDone > 0 ? `${progress.batchesDone} of ${progress.batches} went through` : "";

  const rows: PredictStepRow[] = [
    walletReady && wallet
      ? { key: "wallet", title: "Trade wallet", subtitle: shortenAddress(wallet.address), view: "done" }
      : {
          key: "wallet",
          title: "Create a trade wallet",
          subtitle: walletRow?.state === "running" ? txWait : "",
          view: walletRow?.state === "running" ? "running" : "idle",
        },
    {
      key: "funds",
      title: "Add funds",
      // while it runs the amount is in the locked field above, so the row shows only the wait
      subtitle: fundsState === "running" ? txWait : adding,
      view:
        fundsState === "running"
          ? "running"
          : fundsState === "success"
            ? "done"
            : halted || adding === ""
              ? "inactive"
              : "idle",
    },
    {
      key: "predict",
      title: "Place prediction",
      subtitle: predictRunning
        ? batches.length > 1
          ? `${runningBatch + 1} of ${batches.length}${stageCopy ? ` · ${stageCopy}` : ""}`
          : stageCopy
        : "",
      view: predictRunning ? "running" : progress?.stage === "complete" ? "done" : halted ? "inactive" : "idle",
    },
  ];

  const started = progress && progress.stage !== "idle" ? { started: true as const } : {};
  if (!halted)
    return {
      rows,
      ...started,
      ...(reconciling ? { note: RECONCILING_COPY } : {}),
      ...(checking ? { pricing: true as const } : {}),
    };

  const marked = rows.map((stepRow) =>
    stepRow.key === failedKey
      ? { ...stepRow, view: "failed" as const, subtitle: stepRow.key === "predict" ? partial : stepRow.subtitle }
      : stepRow,
  );
  const reason = progress.pendingHash
    ? PENDING_COPY
    : progress.failure?.reason === "funds" && progress.moneyMoved
      ? FEE_ONLY_OUT_OF_FUNDS_COPY
      : progress.failure?.reason === "credits" && progress.moneyMoved
        ? CREDITS_LOCKED_COPY
        : progress.failure
          ? FAILURE_COPY[progress.failure.reason]
          : FAILURE_COPY.unknown;
  return { rows: marked, failure: reason, ...started, ...(progress.pendingHash ? { pending: true as const } : {}) };
}

export interface StatusLine {
  text: string;
  tone: "neutral" | "warning" | "error";
  /** Said for the visitor's information only, in the popup's small type on one line. */
  small?: true;
}

/**
 * The popup's one status line under the steps, most pressing first: what the visitor has to do,
 * why a run stopped, what a run is checking, or what it left out. Empty while things go normally.
 */
export function statusLine(args: {
  steps: PredictSteps;
  notice?: string;
  leftOut: number;
  /** What changed when the pools were read again before signing, waiting for the visitor to confirm. */
  moved?: MovedStatus;
  /** The credits swap's loss as Details shows it, when it is large enough to say before a run. */
  creditsLoss?: string;
}): StatusLine | null {
  const { steps, notice, leftOut, moved, creditsLoss } = args;
  if (notice) return { text: notice, tone: "warning" };
  if (steps.failure) return { text: steps.failure, tone: steps.pending ? "warning" : "error" };
  if (moved !== undefined) return { text: movedText(moved), tone: "warning" };
  if (steps.note) return { text: steps.note, tone: "neutral" };
  if (creditsLoss !== undefined && !steps.started) {
    return { text: `Credits swap loses ${creditsLoss}.`, tone: "warning", small: true };
  }
  if (leftOut > 0) return { text: `${leftOutText(leftOut)}.`, tone: "neutral" };
  return null;
}

export interface MovedStatus {
  /** Markets whose plan changed. */
  markets: number;
  /** The credits swap now pays less than its shown floor. */
  credits: boolean;
  /** The one market that moved, where it now goes and where it went before. */
  only?: { name: string; to: string; was: string };
  /** The plans changed with the visitor's new slippage, not with the pools. */
  bySlippage?: true;
}

/** A market name longer than this is not quoted on the two-line status line. */
const NAMED_MAX = 24;

/** Said when the pools moved since Details was read, before anything more is signed. */
function movedText({ markets, credits, only, bySlippage }: MovedStatus): string {
  if (bySlippage) return "Your new slippage changes the trades. Check Details, then confirm.";
  if (!credits && markets === 1 && only && only.name.length <= NAMED_MAX) {
    // a figure and its unit wrap as one
    const whole = (value: string) => value.replaceAll(" ", "\u00a0");
    return `${only.name} now goes to ${whole(only.to)}, not ${whole(only.was)}. Confirm to go on.`;
  }
  const count = `${markets} ${markets === 1 ? "market" : "markets"}`;
  const what = credits
    ? markets > 0
      ? `Prices moved on ${count} and the credits swap`
      : "The credits swap now pays less"
    : `Prices moved on ${count}`;
  return `${what}. Check Details, then confirm.`;
}

/** The button's label while the visitor is asked to confirm the new figures. */
export const CONFIRM_MOVED = "Confirm new prices";

/** The button's label where the new figures come from the visitor's new slippage. */
export const CONFIRM_SLIPPAGE = "Confirm trades";

/** "2 estimates could not be traded", with no full stop. */
export function leftOutText(count: number): string {
  return `${count} ${count === 1 ? "estimate" : "estimates"} could not be traded`;
}
