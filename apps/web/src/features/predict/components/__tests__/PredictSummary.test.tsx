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

const WAD = 10n ** 18n;
const sDai = { symbol: "sDAI", decimals: 18 };

const head = () => screen.getByRole("button");
/** The market rows a visitor can see and reach: role queries leave out an aria-hidden list. */
const rows = () => {
  const list = screen.queryByRole("list", { name: "Markets" });
  return list ? [...list.querySelectorAll<HTMLElement>(":scope > li")] : [];
};
/** An option's legs, each its label and value as read aloud. */
const legs = (name: string) =>
  within(screen.getByRole("list", { name: `Trades for ${name}` }))
    .getAllByRole("listitem")
    .map((leg) => leg.textContent!.replace(/\s+/g, " "));

function renderSummary(
  preview: Record<string, PriceMove>,
  isOpen = false,
  list = selected,
  mint?: { amount: bigint; noun: string },
) {
  return render(
    <PredictSummary
      selected={list}
      preview={preview}
      collateral={sDai}
      mint={mint}
      isOpen={isOpen}
      onToggle={vi.fn()}
    />,
  );
}

type Plan = NonNullable<PriceMove["plan"]>;
const NO_TRADES: Plan = { split: 0n, sells: [], merge: 0n, buys: [] };
/** `units` hundredths of a token. */
const cents = (units: bigint) => (units * WAD) / 100n;

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

describe("PredictSummary's trades", () => {
  it("lists an option's legs in the order the run makes them, with ≈ on every figure the pool maths simulates", () => {
    const plan: Plan = {
      split: 10n * WAD,
      sells: [{ side: "down", amountIn: cents(720n), underlyingOut: cents(310n) }],
      merge: cents(280n),
      buys: [{ side: "up", amountIn: cents(580n), outcomeOut: cents(840n) }],
    };
    renderSummary({ [GERWIG]: { from: 312, to: 355, plan } }, true);

    expect(legs("Greta Gerwig")).toEqual([
      "Split10 tokens → 10 UP + 10 DOWN",
      "Sell7.2 DOWN → ≈ 3.1 tokens",
      "Merge2.8 pairs → 2.8 tokens",
      "Buy≈ 5.8 tokens → ≈ 8.4 UP",
    ]);
  });

  it("names a buy the merge alone pays for exactly", () => {
    const plan: Plan = {
      split: WAD,
      sells: [],
      merge: WAD,
      buys: [{ side: "down", amountIn: cents(98n), outcomeOut: 2n * WAD }],
    };
    renderSummary({ [GERWIG]: { from: 312, to: 300, plan } }, true);

    expect(legs("Greta Gerwig").at(-1)).toBe("Buy0.98 tokens → ≈ 2 DOWN");
  });

  it("colours UP in the success tone and DOWN in the error tone", () => {
    const plan: Plan = {
      ...NO_TRADES,
      split: WAD,
      sells: [{ side: "down", amountIn: WAD, underlyingOut: cents(40n) }],
    };
    renderSummary({ [GERWIG]: { from: 312, to: 355, plan } }, true);
    const trades = within(screen.getByRole("list", { name: "Trades for Greta Gerwig" }));

    expect(trades.getByText("1 UP")).toHaveClass("text-fs-tone-success-text");
    for (const down of trades.getAllByText("1 DOWN")) expect(down).toHaveClass("text-fs-tone-error-text");
  });

  it("leaves out a split and a merge of nothing", () => {
    const plan: Plan = { ...NO_TRADES, sells: [{ side: "up", amountIn: WAD, underlyingOut: cents(25n) }] };
    renderSummary({ [GERWIG]: { from: 312, to: 280, plan } }, true);

    expect(legs("Greta Gerwig")).toEqual(["Sell1 UP → ≈ 0.25 tokens"]);
  });

  it("says an option with no trades is left out", () => {
    renderSummary({ [GERWIG]: { from: 312, to: 312, plan: NO_TRADES } }, true);

    expect(legs("Greta Gerwig")).toEqual(["No tradeAlready at your estimate; left out"]);
  });

  it("groups a large figure and cuts it to two decimals", () => {
    const plan: Plan = {
      ...NO_TRADES,
      sells: [{ side: "down", amountIn: 1_234_567_891n * 10n ** 15n, underlyingOut: WAD }],
    };
    renderSummary({ [GERWIG]: { from: 312, to: 355, plan } }, true);

    expect(legs("Greta Gerwig")).toEqual(["Sell1,234,567.89 DOWN → ≈ 1 tokens"]);
  });

  it("closes with a note that prices are checked again, once any option is planned", () => {
    renderSummary({ [GERWIG]: { from: 312, to: 312, plan: NO_TRADES } }, true);

    expect(screen.getByTestId("trades-note")).toHaveTextContent(
      /^Planned from today's pools\. Prices are checked again when you confirm\.$/,
    );
  });

  it("has no note before any option is planned", () => {
    renderSummary({ [GERWIG]: { from: 312, to: 355 } }, true);

    expect(screen.queryByTestId("trades-note")).toBeNull();
  });

  it("mints the collateral going in into a token of every option", () => {
    renderSummary({}, true, selected, { amount: 10n * WAD, noun: "city" });

    expect(screen.getByTestId("trade-mint")).toHaveTextContent(/^Mint10 sDAI → 10 tokens of every city$/);
  });

  it("names no mint with nothing going in", () => {
    renderSummary({}, true, selected, { amount: 0n, noun: "city" });

    expect(screen.queryByTestId("trade-mint")).toBeNull();
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
