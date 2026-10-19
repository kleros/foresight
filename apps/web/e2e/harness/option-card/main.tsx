import { createRoot } from "react-dom/client";

import { useEstimateStore } from "@/features/predict/stores/estimateStore";
import type { SessionStatus } from "@/features/sessions/types";

import { OptionCard } from "@/app/market/[parentMarket]/_components/OptionCard";

import "@/styles/global.css";
import "../inter.css";

const params = new URLSearchParams(window.location.search);
const number = (name: string, fallback: number) => Number(params.get(name) ?? fallback);
const PARENT = "0x7777777777777777777777777777777777777777";
const MARKET = "0x1111111111111111111111111111111111111111";
const WAD = 10n ** 18n;
/** `?market=none` for an option with no trading. `?up=` and `?down=` a held position in whole tokens, decimals allowed; with neither there is none. */
const tokens = (name: string) => {
  const [whole = "0", fraction = ""] = (params.get(name) ?? "0").split(".");
  return BigInt(whole) * WAD + BigInt(fraction.padEnd(18, "0").slice(0, 18) || "0");
};
const position = params.has("up") || params.has("down") ? { up: tokens("up"), down: tokens("down") } : undefined;
if (params.get("theme") === "dark") document.documentElement.classList.add("dark");
useEstimateStore.setState({ estimates: params.has("value") ? { [PARENT]: { [MARKET]: number("value", 0) } } : {} });

function Harness() {
  return (
    <div className="p-4">
      <OptionCard
        option={{
          market: MARKET,
          outcomeIndex: 0,
          name: params.get("name") ?? "Movie A",
          color: params.get("color") ?? "#7e1bd4",
          unit: params.get("unit") ?? "%",
          lowerBound: number("lower", 0),
          upperBound: number("upper", 100),
          question: "What percentile score will Scooby assign to Movie A? (session #2)",
          upToken: null,
          downToken: null,
          invalidToken: null,
          underlyingToken: null,
          blocks: [
            { type: "markdown", body: "Resolves to the score Scooby gives after watching. 0 if he does not watch it." },
          ],
        }}
        parentMarket={PARENT}
        status={(params.get("status") as SessionStatus | null) ?? "trading"}
        marketEstimate={params.get("market") === "none" ? undefined : number("market", 75)}
        isMarketPending={false}
        position={position}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
