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

const segment = (side: "up" | "down") => screen.getByTestId(`position-bar-${side}`);

describe("PositionRow", () => {
  it("names the UP and DOWN held under the bar's two ends", () => {
    render(
      <PositionRow
        scale={scale}
        position={{ up: 214_09n * 10n ** 16n, down: 144n * 10n ** 16n }}
        marketEstimate={75}
        decimals={18}
      />,
    );

    expect(screen.getByText("214.09 UP")).toBeInTheDocument();
    expect(screen.getByText("1.44 DOWN")).toBeInTheDocument();
  });

  it("groups a large holding in threes", () => {
    render(
      <PositionRow scale={scale} position={{ up: 1_234_567n * WAD, down: 0n }} marketEstimate={75} decimals={18} />,
    );

    expect(screen.getByText("1,234,567 UP")).toBeInTheDocument();
  });

  it("splits the bar by the share of UP and DOWN held", () => {
    render(<PositionRow scale={scale} position={{ up: 3n * WAD, down: 1n * WAD }} marketEstimate={75} decimals={18} />);

    expect(segment("up").style.transform).toBe("scaleX(0.75)");
    expect(segment("down").style.transform).toBe("scaleX(0.25)");
  });

  it("keeps a small side visible on the bar", () => {
    render(
      <PositionRow scale={scale} position={{ up: 10_000n * WAD, down: 1n * WAD }} marketEstimate={75} decimals={18} />,
    );

    expect(segment("down").style.transform).not.toBe("scaleX(0)");
  });

  it("values the position at the market estimate, in the option's own tokens", () => {
    // at 75 of 0-100: 200 UP pay 150 and 40 DOWN pay 10
    render(
      <PositionRow scale={scale} position={{ up: 200n * WAD, down: 40n * WAD }} marketEstimate={75} decimals={18} />,
    );

    expect(screen.getByText("≈ 160 Movie A tokens")).toBeInTheDocument();
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

    expect(screen.queryByText(/^≈/)).toBeNull();
  });

  it("says an estimate on the position's side adds to it", () => {
    render(
      <PositionRow
        scale={scale}
        position={{ up: 9n * WAD, down: 1n * WAD }}
        marketEstimate={75}
        decimals={18}
        estimate={{ value: 87, direction: "higher" }}
      />,
    );

    expect(screen.getByText("87 % adds to your UP")).toBeInTheDocument();
  });

  it("says an estimate on the other side sells some of the position", () => {
    render(
      <PositionRow
        scale={scale}
        position={{ up: 9n * WAD, down: 1n * WAD }}
        marketEstimate={75}
        decimals={18}
        estimate={{ value: 55, direction: "lower" }}
      />,
    );

    expect(screen.getByText("55 % sells some UP")).toBeInTheDocument();
  });

  it("says nothing of an estimate against a position held evenly", () => {
    render(
      <PositionRow
        scale={scale}
        position={{ up: 5n * WAD, down: 5n * WAD }}
        marketEstimate={75}
        decimals={18}
        estimate={{ value: 87, direction: "higher" }}
      />,
    );

    expect(screen.queryByText(/your UP|some UP|your DOWN|some DOWN/)).toBeNull();
  });

  it("holds an empty line where the estimate's effect goes while no estimate is set", () => {
    render(<PositionRow scale={scale} position={{ up: 214n * WAD, down: WAD }} marketEstimate={75} decimals={18} />);

    expect(screen.getByTestId("position-consequence")).toBeEmptyDOMElement();
  });
});
