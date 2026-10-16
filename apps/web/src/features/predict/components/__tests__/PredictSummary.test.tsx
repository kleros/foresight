import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { OptionScale } from "@/types/optionScale";

import type { ListedEstimate, PriceMove } from "../PredictList";
import { PredictSummary } from "../PredictSummary";

const scale = (market: string, name: string): OptionScale => ({
  market: market as `0x${string}`,
  name,
  color: "#009aff",
  unit: "$M",
  lowerBound: 0,
  upperBound: 500,
});

const GERWIG = "0xcccccccccccccccccccccccccccccccccccccccc";
const COOGLER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const VILLENEUVE = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const estimate = (market: string, name: string, marketEstimate: number | undefined): ListedEstimate => ({
  scale: scale(market, name),
  value: 400,
  marketEstimate,
  direction: "higher",
});

const selected = [
  estimate(GERWIG, "Greta Gerwig", 312),
  estimate(COOGLER, "Ryan Coogler", 296),
  estimate(VILLENEUVE, "Denis Villeneuve", undefined),
];

const head = () => screen.getByRole("button");
/** The rows a visitor can see and reach: role queries leave out an aria-hidden list. */
const rows = () => screen.queryAllByRole("listitem");

function renderSummary(preview: Record<string, PriceMove>, isOpen = false, list = selected) {
  return render(<PredictSummary selected={list} preview={preview} isOpen={isOpen} onToggle={vi.fn()} />);
}

describe("PredictSummary's headline", () => {
  it("counts only the markets whose shown value moves", () => {
    renderSummary({ [GERWIG]: { from: 312, to: 355 }, [COOGLER]: { from: 296, to: 296.0001 } });

    expect(head()).toHaveTextContent(/^1 market moves$/);
  });

  it("says market prices when none of them moves", () => {
    renderSummary({ [GERWIG]: { from: 312, to: 312 }, [COOGLER]: { from: 296, to: 296.0001 } });

    expect(head()).toHaveTextContent(/^Market prices$/);
  });

  it("says nothing else beside the count", () => {
    renderSummary({ [GERWIG]: { from: 312, to: 355 }, [COOGLER]: { from: 296, to: 280 } });

    expect(head().textContent).toMatch(/^(\d+ markets move|1 market moves|Market prices|Checking prices…)$/);
  });
});

describe("PredictSummary's rows", () => {
  it("lists one row per estimate, each its name and where its market goes, and nothing more", () => {
    renderSummary({ [GERWIG]: { from: 312, to: 355 }, [COOGLER]: { from: 296, to: 296 } }, true);

    expect(rows().map((row) => row.textContent)).toEqual([
      "Greta Gerwig312 → 355 $M",
      "Ryan CooglerStays at 296 $M",
      "Denis VilleneuveNo preview",
    ]);
  });

  it("says Now and the market's value before a preview is read", () => {
    renderSummary({}, true, selected.slice(0, 1));

    expect(rows().map((row) => row.textContent)).toEqual(["Greta GerwigNow 312 $M"]);
  });

  it("says No preview for a market with neither a preview nor a value", () => {
    renderSummary({}, true, selected.slice(2));

    expect(within(rows()[0]!).getByTestId("market-move")).toHaveTextContent(/^No preview$/);
  });
});

describe("PredictSummary closed", () => {
  it("keeps its rows on the page for the toggle to point at, hidden and out of reach", () => {
    renderSummary({ [GERWIG]: { from: 312, to: 355 } });

    const list = document.getElementById(head().getAttribute("aria-controls")!);
    expect(list).not.toBeNull();
    expect(list).toHaveAttribute("aria-hidden", "true");
    expect(list).toHaveAttribute("inert");
    expect(rows()).toEqual([]);
  });

  it("opens them to reading and to focus", () => {
    renderSummary({ [GERWIG]: { from: 312, to: 355 } }, true);

    const list = document.getElementById(head().getAttribute("aria-controls")!);
    expect(list).not.toHaveAttribute("aria-hidden");
    expect(list).not.toHaveAttribute("inert");
    expect(rows()).toHaveLength(3);
  });
});
