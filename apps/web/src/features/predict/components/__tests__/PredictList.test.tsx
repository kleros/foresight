import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { addresses } from "@/testing/fixtures";

import { PredictList, type ListedEstimate } from "../PredictList";

const market = addresses.childMarkets[0];
const estimate: ListedEstimate = {
  scale: { market, name: "Movie A", color: "#009aff", unit: "%", lowerBound: 0, upperBound: 100 },
  value: 87,
  marketEstimate: 75,
  direction: "higher",
};

const list = (move?: { from: number; to: number }) =>
  render(
    <PredictList
      selected={[estimate]}
      onRemove={vi.fn()}
      isReadOnly={false}
      preview={move ? { [market.toLowerCase()]: move } : {}}
    />,
  );

describe("PredictList's rows", () => {
  it("reads each estimate as its name, its value and which side of the market it is on", () => {
    list({ from: 75, to: 80 });
    const row = screen.getByRole("listitem");

    expect(within(row).getByText("Movie A")).toBeInTheDocument();
    expect(row).toHaveTextContent("Estimate 87 %");
    expect(within(row).getByRole("img", { name: "above the market" })).toBeInTheDocument();
    expect(row).toHaveTextContent("Higher than the market");
  });

  it("says where the market moves from and to", () => {
    list({ from: 75, to: 80 });

    expect(screen.getByTestId("estimate-move")).toHaveTextContent("Market moves from 75 % to 80 %");
  });

  it("holds the move's line with where the market is while the move is not known, so the row keeps its height", () => {
    list();

    expect(screen.getByTestId("estimate-move")).toHaveTextContent("Market at 75 %");
  });
});
