import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { addresses, dune } from "@/testing/fixtures";

import type { SessionChartData, SessionChartSeries } from "../../types";
import { SessionChartLegend } from "../SessionChartLegend";

function series(overrides: Partial<SessionChartSeries["option"]>, lastValue: number): SessionChartSeries {
  return {
    option: {
      market: addresses.childMarkets[0],
      name: dune.director.displayName,
      color: dune.director.color,
      unit: dune.unit,
      lowerBound: 0,
      upperBound: 500,
      ...overrides,
    },
    points: [{ timestamp: 1756000100, value: lastValue }],
  };
}

const data: SessionChartData = [
  series({}, 296),
  series({ market: addresses.childMarkets[1], name: "Villeneuve" }, 312),
];

function renderLegend({
  visibleKeys = new Set<string>(addresses.childMarkets),
  onToggle = vi.fn(),
}: { visibleKeys?: Set<string>; onToggle?: (key: string) => void } = {}) {
  render(<SessionChartLegend data={data} noun="directors" visibleKeys={visibleKeys} onToggle={onToggle} />);
}

describe("SessionChartLegend", () => {
  it("ranks the pills by latest estimate, highest first, in the option's own unit", () => {
    renderLegend();

    const pills = screen.getAllByTitle(/\$M/);

    expect(pills.map((pill) => pill.title)).toEqual(["Villeneuve 312 $M", "Greta Gerwig 296 $M"]);
  });

  it("narrows the pills as the search is typed", async () => {
    renderLegend();

    await userEvent.type(screen.getByRole("searchbox", { name: "Search directors" }), "vill");

    expect(screen.getAllByTitle(/\$M/).map((pill) => pill.title)).toEqual(["Villeneuve 312 $M"]);
  });

  it("says when no option matches the search", async () => {
    renderLegend();

    await userEvent.type(screen.getByRole("searchbox", { name: "Search directors" }), "coogler");

    expect(screen.getByText("No directors found")).toBeInTheDocument();
  });

  it("reports the toggled option by its market", async () => {
    const onToggle = vi.fn();
    renderLegend({ onToggle });

    await userEvent.click(screen.getByTitle("Greta Gerwig 296 $M"));

    expect(onToggle).toHaveBeenCalledWith(addresses.childMarkets[0]);
  });

  it("clears every visible pill at once", async () => {
    const onToggle = vi.fn();
    renderLegend({ onToggle, visibleKeys: new Set([addresses.childMarkets[0]]) });

    await userEvent.click(screen.getByRole("button", { name: "Clear all" }));

    expect(onToggle.mock.calls).toEqual([[addresses.childMarkets[0]]]);
  });

  it("offers to show everything once nothing is visible", async () => {
    const onToggle = vi.fn();
    renderLegend({ onToggle, visibleKeys: new Set() });

    await userEvent.click(screen.getByRole("button", { name: "Show all" }));

    expect(onToggle.mock.calls).toEqual([[addresses.childMarkets[0]], [addresses.childMarkets[1]]]);
  });
});
