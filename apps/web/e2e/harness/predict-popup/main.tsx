import { createRoot } from "react-dom/client";

import { PredictDialog } from "@/features/predict/components/PredictDialog";
import type { ListedEstimate } from "@/features/predict/components/PredictList";

import "@/styles/global.css";

const WAD = 10n ** 18n;

const CITIES = ["Berlin", "Lisbon", "Nairobi", "Montevideo", "Hanoi"];

/** `?options=N` estimates, alternating higher and lower, each with a market move. */
const count = Number(new URLSearchParams(window.location.search).get("options") ?? "2");

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
  direction: index % 2 === 0 ? "higher" : "lower",
}));

const preview = Object.fromEntries(
  selected.map((estimate) => [estimate.scale.market.toLowerCase(), { from: 250, to: 280 }]),
);

const sDai = { id: "collateral" as const, symbol: "sDAI", decimals: 18 };

createRoot(document.getElementById("root")!).render(
  <>
    <header className="fs-header sticky top-0 z-30 flex h-16 w-full" />
    <PredictDialog
      isOpen
      onClose={() => {}}
      selected={selected}
      onRemove={() => {}}
      preview={preview}
      amount={10n * WAD}
      onAmountChange={() => {}}
      tokens={[sDai]}
      token={sDai}
      onTokenChange={() => {}}
      funding={{
        available: 25n * WAD,
        collateralIn: 10n * WAD,
        tradeWallet: 6n * WAD,
        fromTradeWallet: 6n * WAD,
        toAdd: 4n * WAD,
        deposit: 4n * WAD,
      }}
      collateral={{ symbol: "sDAI", decimals: 18 }}
      isFirstPrediction
      steps={{
        rows: [
          { key: "wallet", title: "Create a trade wallet", subtitle: "", view: "idle" },
          { key: "funds", title: "Add funds to your trade wallet", subtitle: "Adding 4 sDAI", view: "idle" },
          { key: "predict", title: "Make prediction", subtitle: "", view: "idle" },
        ],
      }}
      skipped={0}
      isRunning={false}
      canRetry={false}
      onPredict={() => {}}
    />
  </>,
);
