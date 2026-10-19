import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { parseUnits } from "viem";

import { PredictButton } from "@/features/predict/components/PredictButton";
import { PredictDialog } from "@/features/predict/components/PredictDialog";
import type { ListedEstimate } from "@/features/predict/components/PredictList";
import { SLIPPAGE_BPS } from "@/features/predict/oracle/tolerances";
import type { PredictFailureReason, PredictProgress } from "@/features/predict/run/types";
import { creditLines, creditsOffer } from "@/features/predict/utils/credits";
import { planFunding } from "@/features/predict/utils/funding";
import { previewTrades } from "@/features/predict/utils/plan";
import { fundsToAdd, predictSteps } from "@/features/predict/utils/predictSteps";

import { estimateToPriceWad, priceWadToEstimate } from "@/utils/optionPrice";

import { PredictSuccessView } from "@/app/market/[parentMarket]/_components/PredictSuccessView";
import type { PoolLiquidity } from "@/types/pool";

import "@/styles/global.css";
import "../inter.css";

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
/** `?trades=worst` a 62-character name, seven-digit amounts and a market already at its estimate. */
const isWorst = params.get("trades") === "worst";
if (isWorst) CITIES[0] = "Greater Lisbon and Setúbal Peninsula metropolitan area, Lisboa";
/** `?options=N` estimates, alternating higher and lower, each with a market move. */
const count = Number(params.get("options") ?? "2");
/** `?state=` one of STATES: the popup as each point of a run leaves it. */
const state = (params.get("state") ?? "idle") as State;
/** `?reason=` the failure a `failed` popup shows; "fee" is the funds failure after money moved. */
const reason = params.get("reason") ?? "fee";
/** `?first=0` a returning predictor: a funded trade wallet and nothing typed. */
const isFirstPrediction = params.get("first") !== "0";
/** `?held=` the sDAI in the visitor's own wallet, as a decimal. */
const held = parseUnits(params.get("held") ?? (isWorst ? "2000000" : "19"), 18);
if (params.get("theme") === "dark") document.documentElement.classList.add("dark");
/** `?dialog=success` the dialog a finished run opens; `&subscribed=0` for a visitor without resolution emails. */
const dialog = params.get("dialog");
/** `&verified=0` a subscribed visitor whose email is not confirmed yet. */
const isEmailVerified = params.get("verified") !== "0";
/** `&signin=busy` the success dialog's sign-in while the wallet signs. */
const signingIn = params.get("signin") === "busy";
/** `?leftOut=N` estimates the run left out, said on the status line; a `harness-left-out` event changes it after open. */
const initialLeftOut = Number(params.get("leftOut") ?? "0");

/** `?credits=` the visitor's Foresight credits, as CREDITS names them; none by default. The tick starts on, as in the app. */
const creditsState = params.get("credits") as keyof typeof CREDITS | null;
const CREDITS = {
  enough: { wallet: 15n * WAD, tradeWallet: 0n, manager: 1000n * WAD },
  partial: { wallet: 3n * WAD, tradeWallet: 1n * WAD, manager: 1000n * WAD },
  short: { wallet: 50n * WAD, tradeWallet: 0n, manager: 20n * WAD },
  empty: { wallet: 120n * WAD, tradeWallet: 0n, manager: 0n },
  /** a four-decimal manager balance, short of a larger holding and under the per-run cap */
  long: { wallet: 2000n * WAD, tradeWallet: 0n, manager: parseUnits("81.7347", 18) },
};
const heldCredits = creditsState ? (CREDITS[creditsState] ?? null) : null;
const offer = creditsOffer(heldCredits);

const selected: ListedEstimate[] = CITIES.slice(0, count).map((name, index) => ({
  scale: {
    market: `0x${String(index + 1).repeat(40)}`,
    name,
    color: "#009aff",
    unit: "$M",
    lowerBound: 0,
    upperBound: 500,
  },
  value: isWorst && index === 1 ? 250 : 400 - index * 40,
  marketEstimate: 250,
  direction: index % 2 === 0 ? "higher" : "lower",
}));

const sDai = { id: "collateral" as const, symbol: "sDAI", decimals: 18 };
/** `?tokens=2` offers xDAI beside sDAI, so the token select can open. */
const tokens = params.get("tokens") === "2" ? [sDai, { id: "native" as const, symbol: "xDAI", decimals: 18 }] : [sDai];
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
  leftOut: [],
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
  // `&step=1` signs the first step, creating the trade wallet
  signing: run("signing", params.get("step") === "1" ? ["running"] : ["success", "running"]),
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

const amount =
  state === "over"
    ? held + 980n * WAD
    : isFirstPrediction
      ? isWorst
        ? parseUnits("1234567.89", 18)
        : 10n * WAD
      : undefined;
const fundingFor = (isUsing: boolean) =>
  state === "disconnected"
    ? null
    : planFunding({
        amount: amount ?? 0n,
        ownWallet: held,
        tradeWallet: 6n * WAD,
        credits: isUsing ? creditLines(heldCredits, offer) : [],
      });
const funding = fundingFor(false);

/** Each option's pools at the market's 250 of 500, deep enough that ten tokens move it visibly. */
const pool = (scale: ListedEstimate["scale"], side: "up" | "down"): PoolLiquidity => {
  const upPrice = Number(estimateToPriceWad(250, scale)) / 1e18;
  const price = side === "up" ? upPrice : 1 - upPrice;
  return {
    sqrtPriceX96: BigInt(Math.round(Math.sqrt(price) * 2 ** 48)) * 2n ** 48n,
    tick: 0,
    liquidity: (isWorst ? 4_000_000n : 20n) * WAD,
    fee: 0n,
    ticks: [],
    outcomeIsToken0: true,
  };
};
/** Underlying already in the trade wallet for every option, so a returning predictor still trades. */
const HELD_UNDERLYING = 2n * WAD;

const preview = Object.fromEntries(
  selected.map((estimate) => {
    const trades = previewTrades(
      {
        pools: { up: pool(estimate.scale, "up"), down: pool(estimate.scale, "down") },
        targetPriceWad: estimateToPriceWad(estimate.value, estimate.scale),
        held: { up: 0n, down: 0n, invalid: 0n },
        splitAmount: HELD_UNDERLYING + (funding?.collateralIn ?? 0n),
      },
      SLIPPAGE_BPS,
    )!;
    const { from, to, ...plan } = trades;
    return [
      estimate.scale.market.toLowerCase(),
      {
        from: priceWadToEstimate(from, estimate.scale),
        to: priceWadToEstimate(to, estimate.scale),
        plan: { ...plan, held: plan.split > 0n ? HELD_UNDERLYING : 0n },
      },
    ];
  }),
);
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
    placed={{ estimates: Math.min(count, 2), amount: 10n * WAD, symbol: "sDAI", decimals: 18 }}
    leftOut={count > 2 ? CITIES.slice(2, count) : []}
    onClose={() => {}}
    subscribed={params.get("subscribed") !== "0"}
    email="visitor@example.com"
    isEmailVerified={isEmailVerified}
    // the app's sign-in needs a wallet; this draws its button as PredictSuccessDialog does
    signUp={
      <PredictButton
        text="Sign in to subscribe"
        busyText={signingIn ? "Signing in…" : undefined}
        isDisabled={false}
        onPress={() => {}}
      />
    }
  />
);

function Harness() {
  const [leftOut, setLeftOut] = useState(initialLeftOut);
  const [typed, setTyped] = useState(amount);
  const [isUsing, setIsUsing] = useState(true);
  const shown = isUsing ? fundingFor(true) : funding;
  useEffect(() => {
    const onLeftOut = (event: Event) => setLeftOut((event as CustomEvent<number>).detail);
    window.addEventListener("harness-left-out", onLeftOut);
    return () => window.removeEventListener("harness-left-out", onLeftOut);
  }, []);
  return (
    <>
      <header className="fs-header sticky top-0 z-30 flex h-16 w-full" />
      {dialog === "success" ? success : null}
      <PredictDialog
        isOpen={dialog !== "success"}
        onClose={() => {}}
        selected={selected}
        onRemove={() => {}}
        preview={state === "recovered" ? undefined : preview}
        amount={typed}
        onAmountChange={setTyped}
        tokens={tokens}
        token={sDai}
        onTokenChange={() => {}}
        funding={shown}
        collateral={collateral}
        credits={offer.state === "none" ? undefined : { offer, isUsing, onUsingChange: setIsUsing }}
        optionNoun="city"
        isFirstPrediction={isFirstPrediction}
        isDisconnected={state === "disconnected"}
        steps={steps}
        leftOut={leftOut}
        isRunning={isRunning}
        canRetry={state === "failed" || state === "pending" || state === "recovered"}
        isPending={state === "pending"}
        recovered={state === "recovered" ? { deposit: 4n * WAD, token: sDai } : undefined}
        notice={state === "disconnected" ? "Connect a wallet to predict." : undefined}
        onPredict={() => {}}
      />
    </>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
