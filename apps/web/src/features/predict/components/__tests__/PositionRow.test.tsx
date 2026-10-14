import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { addresses } from "@/testing/fixtures";
import type { OptionScale } from "@/types/optionScale";

import { PositionRow } from "../PositionRow";

const WAD = 10n ** 18n;
const scale: OptionScale = {
  market: addresses.childMarkets[0],
  name: "Movie A",
  color: "#009aff",
  unit: "%",
  lowerBound: 0,
  upperBound: 100,
};

describe("PositionRow", () => {
  it("lists the UP and DOWN held", () => {
    render(
      <PositionRow
        scale={scale}
        position={{ up: 214_09n * 10n ** 16n, down: 144n * 10n ** 16n }}
        marketEstimate={75}
        decimals={18}
      />,
    );

    expect(screen.getByText("214.09 UP · 1.44 DOWN")).toBeInTheDocument();
  });

  it("values the position at the market estimate, in the option's own tokens", () => {
    // at 75 of 0-100: 200 UP pay 150 and 40 DOWN pay 10
    render(
      <PositionRow scale={scale} position={{ up: 200n * WAD, down: 40n * WAD }} marketEstimate={75} decimals={18} />,
    );

    expect(screen.getByText("≈ 160 Movie A tokens at the market estimate")).toBeInTheDocument();
  });

  it("leaves the value out while the market estimate is unknown", () => {
    render(
      <PositionRow
        scale={scale}
        position={{ up: 200n * WAD, down: 40n * WAD }}
        marketEstimate={undefined}
        decimals={18}
      />,
    );

    expect(screen.queryByText(/at the market estimate/)).toBeNull();
  });

  it("says which side the position leans to", () => {
    render(<PositionRow scale={scale} position={{ up: 1n * WAD, down: 9n * WAD }} marketEstimate={75} decimals={18} />);

    expect(screen.getByText("Leaning lower")).toBeInTheDocument();
  });
});
