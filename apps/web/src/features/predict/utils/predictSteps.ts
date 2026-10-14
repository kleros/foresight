import type { Address } from "viem";

import { shortenAddress } from "@/utils/address";

import { STEP_ID } from "../flow/stepIds";
import type { PredictProgress } from "../run/types";
import type { PayToken } from "../types";
import { shownAmount, type Funding } from "./funding";

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
}

/** The chain's own errors name gas and contracts, which the popup never shows. */
const FAILURE_COPY: Record<NonNullable<PredictProgress["failure"]>["reason"], string> = {
  rejected: "You turned the request down.",
  cancelled: "Your wallet replaced the request with something else.",
  reverted: "The trade could not go through at these prices.",
  rpc: "The network did not answer in time.",
  unknown: "Something went wrong.",
  "no-route": "No trade moves these markets toward your estimates. Try a larger amount or a different estimate.",
  quote: "Prices could not be fetched. Try again in a moment.",
  funds:
    "Your wallet does not have enough to cover this and the network fee. Lower the amount or add funds, then try again.",
  balance: "Your trade wallet balance is lower than shown. Check the amount and try again.",
  "deposit-unconfirmed": "Your last deposit may still be confirming. Check your wallet's activity, then try again.",
  "wrong-wallet": "This prediction was started from another wallet. Connect that wallet to finish it.",
  "wrong-chain": "This prediction was started on another network. Switch to that network to finish it.",
};

/** Once the deposit is in the amount is fixed, so the only thing short is the fee in the wallet. */
const FEE_SHORT_COPY = "Your wallet does not have enough xDAI for the network fee. Add some, then try the rest.";

/** A transaction is out there and nothing has said how it ended, so it is neither a success nor a failure. */
const PENDING_COPY = "Your transaction was sent but has not confirmed yet. It is checked before anything else is sent.";

const STAGE_COPY: Partial<Record<PredictProgress["stage"], string>> = {
  quoting: "Finding the best prices…",
  signing: "Waiting for your signature…",
  confirming: "Confirming…",
  complete: "Prediction successful!",
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
  const runSteps = progress?.steps ?? [];
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
  const becomes = collateral && ` (~${shownAmount(collateral.amount, collateral.decimals)} ${collateral.symbol})`;
  const adding = toAdd === 0n ? "" : `Adding ${shownAmount(toAdd, decimals)} ${symbol}${becomes ?? ""}`;
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
    halted && progress.batchesDone > 0 ? `${progress.batchesDone} of ${progress.batches} predictions went through` : "";

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
      title: "Add funds to your trade wallet",
      // while it runs the amount is in the locked field above; the row says what it waits on
      subtitle: fundsRow?.state === "running" && fundsWait ? fundsWait : adding,
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
      title: "Make prediction",
      subtitle: checking
        ? stageCopy
        : predictRunning
          ? batches.length > 1
            ? `Prediction ${runningBatch + 1} of ${batches.length}. ${stageCopy}`
            : stageCopy
          : progress?.stage === "complete"
            ? stageCopy
            : "",
      view: predictRunning ? "running" : progress?.stage === "complete" ? "done" : halted ? "inactive" : "idle",
    },
  ];

  if (!halted) return { rows };

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
  return { rows: marked, failure: reason };
}

export interface StatusLine {
  text: string;
  tone: "neutral" | "warning" | "error" | "success";
}

/**
 * The popup's one status line under the steps, most pressing first: what the visitor has to do,
 * why a run stopped, what it left out, that it finished, that a stored run is waiting, or, before
 * a run, that nothing is signed until the prices are checked. Null while a step is running.
 */
export function statusLine(args: {
  steps: PredictSteps;
  notice?: string;
  skipped: number;
  isRecovered: boolean;
}): StatusLine | null {
  const { steps, notice, skipped, isRecovered } = args;
  if (notice) return { text: notice, tone: "warning" };
  if (steps.failure) return { text: steps.failure, tone: "error" };
  if (skipped > 0) {
    return {
      text: `${skipped} of your estimates could not be traded right now and ${skipped === 1 ? "was" : "were"} left out.`,
      tone: "neutral",
    };
  }
  if (steps.rows.some((row) => row.key === "predict" && row.view === "done")) {
    return { text: "Prediction placed.", tone: "success" };
  }
  if (isRecovered) return { text: "This prediction did not finish.", tone: "neutral" };
  if (steps.rows.some((row) => row.view === "running")) return null;
  return { text: "Prices are checked before anything is signed.", tone: "neutral" };
}
