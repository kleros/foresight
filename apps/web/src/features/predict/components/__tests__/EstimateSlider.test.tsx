import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { addresses } from "@/testing/fixtures";
import type { OptionScale } from "@/types/optionScale";

import { NEAR_MARKET_SHARE } from "../../utils/estimates";
import { EstimateSlider } from "../EstimateSlider";

const scale: OptionScale = {
  market: addresses.childMarkets[0],
  name: "Greta Gerwig",
  color: "#009aff",
  unit: "$M",
  lowerBound: 0,
  upperBound: 500,
};
const MARKET = 312;
// the near band either side of the market, on this 0-500 scale
const BAND = NEAR_MARKET_SHARE * 500;

function renderSlider(value: number | undefined, extra: { lockedReason?: string } = {}) {
  return render(
    <EstimateSlider
      scale={scale}
      marketEstimate={MARKET}
      isMarketPending={false}
      value={value}
      onCommit={() => {}}
      onClear={() => {}}
      {...extra}
    />,
  );
}

const fill = (container: HTMLElement) => container.querySelector<HTMLElement>("#slider-fill")!;
// react-aria puts the thumb's id on its input, so the drawn thumb is found as the label's parent
const thumb = (container: HTMLElement) => container.querySelector<HTMLElement>("#slider-label")!.parentElement!;
const pin = () => screen.getByTestId("market-pin");

describe("EstimateSlider colours", () => {
  it("fills the track and rims the thumb in the up colour above the market", () => {
    const { container } = renderSlider(400);

    expect(fill(container).style.backgroundColor).toBe("var(--fs-estimate-up)");
    expect(thumb(container).style.borderColor).toBe("var(--fs-estimate-up)");
  });

  it("fills the track and rims the thumb in the down colour below the market", () => {
    const { container } = renderSlider(200);

    expect(fill(container).style.backgroundColor).toBe("var(--fs-estimate-down)");
    expect(thumb(container).style.borderColor).toBe("var(--fs-estimate-down)");
  });

  it("keeps the library's own colour at the market", () => {
    const { container } = renderSlider(undefined);

    expect(fill(container).style.backgroundColor).not.toMatch(/fs-estimate/);
  });

  it("keeps the library's own colour while the slider is locked", () => {
    const { container } = renderSlider(400, { lockedReason: "Trading has closed for this session." });

    expect(fill(container).style.backgroundColor).not.toMatch(/fs-estimate/);
  });
});

describe("EstimateSlider market pin", () => {
  it("stands above the track while the thumb is away from the market", () => {
    renderSlider(MARKET + BAND + 1);

    expect(pin()).toHaveAttribute("data-placement", "up");
  });

  it("drops under the track with the thumb on the market", () => {
    renderSlider(undefined);

    expect(pin()).toHaveAttribute("data-placement", "down");
  });

  it("drops under the track with the thumb inside the near band", () => {
    renderSlider(MARKET - BAND);

    expect(pin()).toHaveAttribute("data-placement", "down");
  });

  it("names the market's number on the pin", () => {
    renderSlider(400);

    expect(pin()).toHaveTextContent("Market 312 $M");
  });
});

describe("EstimateSlider hint", () => {
  it("says how far above the market the estimate sits", () => {
    renderSlider(400);

    expect(screen.getByText("88 $M above the market (312 $M)")).toBeInTheDocument();
  });

  it("says how far below the market the estimate sits", () => {
    renderSlider(250);

    expect(screen.getByText("62 $M below the market (312 $M)")).toBeInTheDocument();
  });

  it("states the unit beside the typed number", () => {
    renderSlider(400);

    expect(screen.getByTestId("estimate-unit")).toHaveTextContent("$M");
  });
});
