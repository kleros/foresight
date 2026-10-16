import type { Address } from "viem";

import { shortenAddress } from "@/utils/address";
import { OUT_OF_FUNDS_COPY } from "@/utils/txErrorText";

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
}

/** The chain's own errors name gas and contracts, which the popup never shows. */
const FAILURE_COPY: Record<NonNullable<PredictProgress["failure"]>["reason"], string> = {
  rejected: "You declined in your wallet.",
  cancelled: "Cancelled or replaced in your wallet.",
  reverted: "The trade failed at these prices.",
  rpc: "The network did not answer.",
  unknown: "Something went wrong.",
  "no-route": "No trade found for these estimates. Try a larger amount.",
  quote: "Could not get prices. Try again shortly.",
  funds: OUT_OF_FUNDS_COPY,
  balance: "Trade wallet balance is lower than shown. Check the amount.",
  "deposit-unconfirmed": "Your last deposit may still be confirming. Check your wallet.",
  "wrong-wallet": "Started from another wallet. Connect it to finish.",
  "wrong-chain": "Started on another network. Switch to it to finish.",
};

/** Once the deposit is in the amount is fixed, so the only thing short is the fee in the wallet. */
const FEE_SHORT_COPY = "Not enough xDAI for the fee. Add some, then try the rest.";

/** A transaction is out there and nothing has said how it ended, so it is neither a success nor a failure. */
const PENDING_COPY = "Sent, not confirmed yet.";

const RECONCILING_COPY = "Checking your last transaction…";

const STAGE_COPY: Partial<Record<PredictProgress["stage"], string>> = {
  quoting: "Finding prices…",
  signing: "Confirm in your wallet",
  confirming: "Confirming…",
};

interface TokenAmount {
  amount: bigint;
  symbol: string;
  decimals: number;
}

/** What the funds step adds, frozen when a run starts so a refreshed balance does not rewrite it. */
export interface FundsToAdd {
  /** In the token the visitor pays with. */
  toAdd: bigint;
  symbol: string;
  decimals: number;
  /** The collateral `toAdd` becomes, when the visitor pays in another token. */
  collateral?: TokenAmount;
}

/** An xDAI payment adds its deposit, which becomes `toAdd` collateral; a collateral payment adds `toAdd` itself. */
export function fundsToAdd(
  funding: Funding | null,
  pay: { id: PayToken; symbol: string; decimals: number },
  collateral: { symbol: string; decimals: number },
): FundsToAdd {
  const toAdd = funding?.toAdd ?? 0n;
  if (pay.id === "collateral") return { toAdd, ...collateral };
  return {
    toAdd: funding?.deposit ?? 0n,
    symbol: pay.symbol,
    decimals: pay.decimals,
    collateral: { amount: toAdd, ...collateral },
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
  const { wallet, toAdd, symbol, decimals, collateral, progress } = args;
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

  const fundsRow = row(STEP_ID.deposit);

  const batches = runSteps.filter((step) => step.id.startsWith("predict-"));
  const runningBatch = batches.findIndex((step) => step.state === "running");
  // the routes are priced before anything is signed, while no step of the run is going yet
  const checking = progress?.stage === "quoting" && !runSteps.some((step) => step.state === "running");
  const predictRunning = runningBatch >= 0 || checking;
  const stageCopy = progress ? (STAGE_COPY[progress.stage] ?? "") : "";
  const becomes = collateral && ` (≈ ${shownAmount(collateral.amount, collateral.decimals)} ${collateral.symbol})`;
  const adding = toAdd === 0n ? "" : `${shownAmount(toAdd, decimals)} ${symbol}${becomes ?? ""}`;
  const fundsWait = progress?.stage === "signing" || progress?.stage === "confirming" ? stageCopy : "";

  // the row whose step errored stopped the run; with none, nothing got past pricing.
  // A sent, unconfirmed transaction may still land, so its row is not crossed.
  const failedKey: PredictStepRow["key"] | undefined =
    halted && !progress.pendingHash
      ? walletRow?.state === "error"
        ? "wallet"
        : fundsRow?.state === "error"
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
          subtitle: walletRow?.state === "running" ? stageCopy : "",
          view: walletRow?.state === "running" ? "running" : "idle",
        },
    {
      key: "funds",
      title: "Add funds",
      // while it runs the amount is in the locked field above, so the row shows only the wait
      subtitle: fundsRow?.state === "running" ? fundsWait : adding,
      view:
        fundsRow?.state === "running"
          ? "running"
          : fundsRow?.state === "success"
            ? "done"
            : halted || toAdd === 0n
              ? "inactive"
              : "idle",
    },
    {
      key: "predict",
      title: "Place prediction",
      subtitle: checking
        ? stageCopy
        : predictRunning
          ? batches.length > 1
            ? `${runningBatch + 1} of ${batches.length}${stageCopy ? ` · ${stageCopy}` : ""}`
            : stageCopy
          : "",
      view: predictRunning ? "running" : progress?.stage === "complete" ? "done" : halted ? "inactive" : "idle",
    },
  ];

  const started = progress && progress.stage !== "idle" ? { started: true as const } : {};
  if (!halted) return { rows, ...started, ...(reconciling ? { note: RECONCILING_COPY } : {}) };

  const marked = rows.map((stepRow) =>
    stepRow.key === failedKey
      ? { ...stepRow, view: "failed" as const, subtitle: stepRow.key === "predict" ? partial : stepRow.subtitle }
      : stepRow,
  );
  const reason = progress.pendingHash
    ? PENDING_COPY
    : progress.failure?.reason === "funds" && progress.moneyMoved
      ? FEE_SHORT_COPY
      : progress.failure
        ? FAILURE_COPY[progress.failure.reason]
        : FAILURE_COPY.unknown;
  return { rows: marked, failure: reason, ...started, ...(progress.pendingHash ? { pending: true as const } : {}) };
}

export interface StatusLine {
  text: string;
  tone: "neutral" | "warning" | "error";
}

/**
 * The popup's one status line under the steps, most pressing first: what the visitor has to do,
 * why a run stopped, what a run is checking, or what it left out. Empty while things go normally.
 */
export function statusLine(args: { steps: PredictSteps; notice?: string; skipped: number }): StatusLine | null {
  const { steps, notice, skipped } = args;
  if (notice) return { text: notice, tone: "warning" };
  if (steps.failure) return { text: steps.failure, tone: steps.pending ? "warning" : "error" };
  if (steps.note) return { text: steps.note, tone: "neutral" };
  if (skipped > 0) return { text: `${leftOutText(skipped)}.`, tone: "neutral" };
  return null;
}

/** "2 estimates could not be traded", with no full stop. */
export function leftOutText(count: number): string {
  return `${count} ${count === 1 ? "estimate" : "estimates"} could not be traded`;
}
