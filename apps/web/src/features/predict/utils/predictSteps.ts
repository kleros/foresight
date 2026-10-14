import { formatUnits, type Address } from "viem";

import { shortenAddress } from "@/utils/address";
import { formatAmount } from "@/utils/amount";

import { STEP_ID } from "../flow/plan";
import { AMOUNT_DISPLAY_DECIMALS } from "../oracle/tolerances";
import type { PredictProgress } from "../run/types";
import type { PayToken } from "../types";
import type { Funding } from "./funding";

export type StepView = "idle" | "running" | "done" | "inactive";

export interface PredictStepRow {
  key: "wallet" | "funds" | "predict";
  title: string;
  subtitle: string;
  view: StepView;
}

export interface PredictSteps {
  rows: PredictStepRow[];
  /** Set once a run has stopped short, in words the visitor can act on. */
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

/** A transaction is out there and nothing has said how it ended, so it is neither a success nor a failure. */
const PENDING_COPY =
  "Your transaction was sent but has not confirmed yet. It may still go through. Press Predict to check again.";

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

const LEAST_SHOWN = formatUnits(1n, AMOUNT_DISPLAY_DECIMALS);

/** Rounded to the nearest shown decimal, so a deposit a wei short of a typed amount reads as typed. */
function shownAmount(value: bigint, decimals: number): string {
  const step = 10n ** BigInt(Math.max(decimals - AMOUNT_DISPLAY_DECIMALS, 0));
  const shown = formatAmount(((value + step / 2n) / step) * step, decimals);
  return shown === "0" && value > 0n ? `less than ${LEAST_SHOWN}` : shown;
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
      subtitle: fundsRow?.state === "running" && fundsWait ? `${adding}. ${fundsWait}` : adding,
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

  const partial =
    progress.batchesDone > 0 ? `${progress.batchesDone} of ${progress.batches} predictions went through. ` : "";
  const reason = progress.pendingHash
    ? PENDING_COPY
    : progress.failure
      ? FAILURE_COPY[progress.failure.reason]
      : FAILURE_COPY.unknown;
  return { rows, failure: `${partial}${reason}` };
}
