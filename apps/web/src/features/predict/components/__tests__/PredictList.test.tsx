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

const list = (to: number) =>
  render(
    <PredictList
      selected={[estimate]}
      onRemove={vi.fn()}
      isReadOnly={false}
      preview={{ [market.toLowerCase()]: { from: 75, to } }}
    />,
  );

describe("PredictList's market move", () => {
  it("names where the market starts when the preview lands on the estimate itself", () => {
    list(87);

    expect(within(screen.getByTestId("estimate-move")).getByText("from 75 %")).toBeInTheDocument();
  });

  it("names where the market lands when it stops short of the estimate", () => {
    list(80);

    expect(within(screen.getByTestId("estimate-move")).queryByText(/^from/)).toBeNull();
    expect(screen.getByTestId("estimate-move")).toHaveTextContent("→ 80 %");
  });
});
