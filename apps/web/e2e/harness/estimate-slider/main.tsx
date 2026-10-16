import { useState } from "react";
import { createRoot } from "react-dom/client";

import { EstimateSlider } from "@/features/predict/components/EstimateSlider";

import "@/styles/global.css";

const params = new URLSearchParams(window.location.search);
const number = (name: string, fallback: number) => Number(params.get(name) ?? fallback);
/** `?track=` the slider's width in px, as an option card gives it at 375 (311) or 1280 (1112). */
const track = number("track", 311);
const lowerBound = number("lower", 0);
const upperBound = number("upper", 100);
const marketEstimate = number("market", 75);
/** `?value=` a saved estimate; without it the slider rests at the market. */
const initial = params.has("value") ? number("value", 0) : undefined;
if (params.get("theme") === "dark") document.documentElement.classList.add("dark");

function Harness() {
  const [value, setValue] = useState(initial);
  return (
    <div className="bg-fs-surface p-4" style={{ width: track + 32 }}>
      <EstimateSlider
        scale={{
          market: "0x1111111111111111111111111111111111111111",
          name: "Movie A",
          color: params.get("color") ?? "#7e1bd4",
          unit: params.get("unit") ?? "%",
          lowerBound,
          upperBound,
        }}
        marketEstimate={marketEstimate}
        isMarketPending={false}
        value={value}
        onCommit={setValue}
        onClear={() => setValue(undefined)}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
