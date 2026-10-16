import { createRoot } from "react-dom/client";

import { Button } from "@kleros/ui-components-library";
import { parseUnits } from "viem";

import { PredictDialog } from "@/features/predict/components/PredictDialog";
import type { ListedEstimate } from "@/features/predict/components/PredictList";
import type { PredictFailureReason, PredictProgress } from "@/features/predict/run/types";
import { planFunding } from "@/features/predict/utils/funding";
import { fundsToAdd, predictSteps } from "@/features/predict/utils/predictSteps";

import { PredictSuccessView } from "@/app/market/[parentMarket]/_components/PredictSuccessView";

import "@/styles/global.css";

const WAD = 10n ** 18n;
const WALLET = "0xdcee0000000000000000000000000000000c664f";

const CITIES = [
  "Berlin",
  "Lisbon metropolitan area",
  "Nairobi",
  "Montevideo",
  "Hanoi",
  "Accra",
  "Kraków",
  "Medellín",
  "Osaka",
  "Tbilisi",
];

const params = new URLSearchParams(window.location.search);
/** `?options=N` estimates, alternating higher and lower, each with a market move. */
const count = Number(params.get("options") ?? "2");
/** `?state=` one of STATES: the popup as each point of a run leaves it. */
const state = (params.get("state") ?? "idle") as State;
/** `?reason=` the failure a `failed` popup shows; "fee" is the funds failure after money moved. */
const reason = params.get("reason") ?? "fee";
/** `?first=0` a returning predictor: a funded trade wallet and nothing typed. */
const isFirstPrediction = params.get("first") !== "0";
/** `?held=` the sDAI in the visitor's own wallet, as a decimal. */
const held = parseUnits(params.get("held") ?? "19", 18);
if (params.get("theme") === "dark") document.documentElement.classList.add("dark");
/** `?dialog=success` the dialog a finished run opens; `&subscribed=0` for a visitor without resolution emails. */
const dialog = params.get("dialog");

const selected: ListedEstimate[] = CITIES.slice(0, count).map((name, index) => ({
  scale: {
    market: `0x${String(index + 1).repeat(40)}`,
    name,
    color: "#009aff",
    unit: "$M",
    lowerBound: 0,
    upperBound: 500,
  },
  value: 400 - index * 40,
  marketEstimate: 250,
  direction: index % 2 === 0 ? "higher" : "lower",
}));

const preview = Object.fromEntries(
  selected.map((estimate) => [estimate.scale.market.toLowerCase(), { from: 250, to: 280 }]),
);

const sDai = { id: "collateral" as const, symbol: "sDAI", decimals: 18 };
const collateral = { symbol: "sDAI", decimals: 18 };

const run = (
  stage: PredictProgress["stage"],
  states: string[],
  extra: Partial<PredictProgress> = {},
): PredictProgress => ({
  stage,
  steps: ["create-wallet", "deposit", "predict-1", "predict-2"].map((id, index) => ({
    id,
    label: "",
    state: (states[index] ?? "pending") as PredictProgress["steps"][number]["state"],
  })),
  skipped: [],
  batchesDone: 0,
  batches: 2,
  ...extra,
});

type State =
  | "idle"
  | "quoting"
  | "signing"
  | "confirming"
  | "failed"
  | "pending"
  | "success"
  | "recovered"
  | "over"
  | "disconnected";

const PROGRESS: Partial<Record<State, PredictProgress>> = {
  quoting: run("quoting", []),
  signing: run("signing", ["success", "running"]),
  confirming: run("confirming", ["success", "success", "success", "running"], { batchesDone: 1 }),
  failed: run("halted", ["success", "success", "success", "error"], {
    batchesDone: 1,
    failure: { reason: (reason === "fee" ? "funds" : reason) as PredictFailureReason, retryable: true },
    moneyMoved: reason === "fee" ? true : undefined,
  }),
  pending: run("halted", ["success", "running"], {
    failure: { reason: "rpc", retryable: true },
    pendingHash: `0x${"ab".repeat(32)}`,
  }),
  success: run("complete", ["success", "success", "success", "success"], { batchesDone: 2 }),
  recovered: run("review", ["success", "success"]),
};

const amount = state === "over" ? held + 980n * WAD : isFirstPrediction ? 10n * WAD : undefined;
const funding =
  state === "disconnected" ? null : planFunding({ amount: amount ?? 0n, ownWallet: held, tradeWallet: 6n * WAD });
const progress = PROGRESS[state] ?? null;
const isRunning = state === "quoting" || state === "signing" || state === "confirming";
const steps = predictSteps({
  wallet: { address: WALLET, deployed: !isFirstPrediction },
  ...fundsToAdd(state === "over" ? null : funding, sDai, collateral),
  progress,
});

const success = (
  <PredictSuccessView
    isOpen
    leftOut={count > 2 ? CITIES.slice(2, count) : []}
    onClose={() => {}}
    subscribed={params.get("subscribed") !== "0"}
    email="visitor@example.com"
    // the app's sign-in needs a wallet; this stands in for its button
    signUp={<Button small text="Sign in to subscribe" />}
  />
);

createRoot(document.getElementById("root")!).render(
  <>
    <header className="fs-header sticky top-0 z-30 flex h-16 w-full" />
    {dialog === "success" ? success : null}
    <PredictDialog
      isOpen={dialog !== "success"}
      onClose={() => {}}
      selected={selected}
      onRemove={() => {}}
      preview={state === "recovered" ? undefined : preview}
      amount={amount}
      onAmountChange={() => {}}
      tokens={[sDai]}
      token={sDai}
      onTokenChange={() => {}}
      funding={funding}
      collateral={collateral}
      isFirstPrediction={isFirstPrediction}
      isDisconnected={state === "disconnected"}
      steps={steps}
      skipped={0}
      isRunning={isRunning}
      isPricing={state === "quoting"}
      canRetry={state === "failed" || state === "pending" || state === "recovered"}
      isPending={state === "pending"}
      recovered={state === "recovered" ? { deposit: 4n * WAD, token: sDai } : undefined}
      notice={state === "disconnected" ? "Connect a wallet to predict." : undefined}
      onPredict={() => {}}
    />
  </>,
);
