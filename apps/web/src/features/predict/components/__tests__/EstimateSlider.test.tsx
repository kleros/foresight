import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { addresses } from "@/testing/fixtures";
import type { OptionScale } from "@/types/optionScale";

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

function renderSlider(
  value: number | undefined,
  extra: { lockedReason?: string; scale?: OptionScale; marketEstimate?: number; isMarketPending?: boolean } = {},
) {
  const onCommit = vi.fn();
  const onClear = vi.fn();
  const rendered = render(
    <EstimateSlider
      scale={extra.scale ?? scale}
      marketEstimate={"marketEstimate" in extra ? extra.marketEstimate : MARKET}
      isMarketPending={extra.isMarketPending ?? false}
      value={value}
      onCommit={onCommit}
      onClear={onClear}
      lockedReason={extra.lockedReason}
    />,
  );
  return { ...rendered, onCommit, onClear };
}

const fill = (container: HTMLElement) => container.querySelector<HTMLElement>("#slider-fill")!;
// react-aria puts the thumb's id on its input, so the drawn thumb is found as the label's parent
const thumb = (container: HTMLElement) => container.querySelector<HTMLElement>("#slider-label")!.parentElement!;
const pin = () => screen.getByTestId("market-pin");
const pill = () => screen.getByRole("button", { name: /, type your estimate for Greta Gerwig$/ });
const field = () => screen.getByRole("textbox", { name: "Your estimate for Greta Gerwig" });

describe("EstimateSlider colours", () => {
  it("colours the gap to the market and rims the thumb in the up colour above the market", () => {
    const { container } = renderSlider(400);

    expect(screen.getByTestId("estimate-span").style.backgroundColor).toBe("var(--fs-estimate-up)");
    expect(fill(container).style.backgroundColor).toBe("transparent");
    expect(thumb(container).style.borderColor).toBe("var(--fs-estimate-up)");
  });

  it("colours the gap to the market and rims the thumb in the down colour below the market", () => {
    const { container } = renderSlider(200);

    expect(screen.getByTestId("estimate-span").style.backgroundColor).toBe("var(--fs-estimate-down)");
    expect(fill(container).style.backgroundColor).toBe("transparent");
    expect(thumb(container).style.borderColor).toBe("var(--fs-estimate-down)");
  });

  it("keeps the library's own colour at the market", () => {
    const { container } = renderSlider(undefined);

    expect(fill(container).style.backgroundColor).not.toMatch(/fs-estimate/);
  });

  it("keeps the library's own colour while the slider is locked", () => {
    const { container } = renderSlider(400, { lockedReason: "Trading has closed." });

    expect(fill(container).style.backgroundColor).not.toMatch(/fs-estimate/);
  });
});

describe("EstimateSlider market pin", () => {
  // jsdom measures nothing, so the drop at a distance is covered by marketPin's tests and the e2e spec
  it("sits under the track with no estimate set, the thumb resting on the market", () => {
    renderSlider(undefined);

    expect(pin()).toHaveAttribute("data-placement", "down");
  });

  it("stands above the track with the thumb away from the market", () => {
    renderSlider(400);

    expect(pin()).toHaveAttribute("data-placement", "up");
  });

  it("names the market's number on the pin", () => {
    renderSlider(400);

    const captions = within(pin()).getAllByText("Market");
    expect(captions.filter((caption) => caption.getAttribute("aria-hidden") !== "true")).toHaveLength(1);
    expect(screen.getByTestId("market-chip")).toHaveTextContent("312 $M");
  });
});

describe("EstimateSlider bounds", () => {
  it("names the last point on the grid as the upper bound, where the bound is between two", () => {
    const { container } = renderSlider(40, { scale: { ...scale, upperBound: 123.456 }, marketEstimate: 60 });

    expect(container.querySelector('[data-bound="lower"]')).toHaveTextContent("0 $M");
    expect(container.querySelector('[data-bound="upper"]')).toHaveTextContent("123 $M");
  });
});

describe("EstimateSlider market chip before the track is measured", () => {
  // jsdom lays nothing out, so the chip is always in its unmeasured place here
  it("stays on the track with the market at either bound", () => {
    for (const [market, shift] of [
      [500, "-100%"],
      [0, "-0%"],
      [125, "-25%"],
    ] as const) {
      const { unmount } = renderSlider(undefined, { marketEstimate: market });
      expect(screen.getByTestId("market-chip").parentElement!.style.transform).toBe(`translateX(${shift})`);
      unmount();
    }
  });
});

describe("EstimateSlider value pill", () => {
  it("shows the estimate above the thumb", () => {
    renderSlider(400);

    expect(pill()).toHaveTextContent("400 $M");
  });

  it("shows the market's number while no estimate is set", () => {
    renderSlider(undefined);

    expect(pill()).toHaveTextContent("312 $M");
  });

  it("is reached by Tab from the slider, and opens as a field holding the value", async () => {
    renderSlider(400);

    screen.getByRole("slider").focus();
    await userEvent.tab();
    expect(pill()).toHaveFocus();
    await userEvent.keyboard("{Enter}");

    expect(field()).toHaveFocus();
    expect(field()).toHaveValue("400");
  });

  it("opens with the value ungrouped, so it reads back as a number", async () => {
    renderSlider(1234, { scale: { ...scale, upperBound: 5000 }, marketEstimate: 3000 });

    await userEvent.click(screen.getByRole("button", { name: /type your estimate/ }));

    expect(field()).toHaveValue("1234");
  });

  it("leaves the thumb and the estimate alone while a number is typed", async () => {
    const { onCommit } = renderSlider(400);

    await userEvent.click(pill());
    await userEvent.clear(field());
    await userEvent.type(field(), "250");

    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole("slider")).toHaveValue("400");
  });

  it("commits a typed number on Enter and hands focus back to the pill", async () => {
    const { onCommit } = renderSlider(400);

    await userEvent.click(pill());
    await userEvent.clear(field());
    await userEvent.type(field(), "250{Enter}");

    expect(onCommit.mock.calls).toEqual([[250]]);
    expect(pill()).toHaveFocus();
  });

  it("commits a typed number when the field loses focus", async () => {
    const { onCommit } = renderSlider(400);

    await userEvent.click(pill());
    await userEvent.clear(field());
    await userEvent.type(field(), "250");
    await userEvent.tab();

    expect(onCommit).toHaveBeenCalledWith(250);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("drops a typed number on Escape and hands focus back to the pill", async () => {
    const { onCommit } = renderSlider(400);

    await userEvent.click(pill());
    await userEvent.clear(field());
    await userEvent.type(field(), "250{Escape}");

    expect(onCommit).not.toHaveBeenCalled();
    expect(pill()).toHaveFocus();
    expect(pill()).toHaveTextContent("400 $M");
  });

  it("takes the unit and grouping commas along with the number", async () => {
    const { onCommit } = renderSlider(400, { scale: { ...scale, upperBound: 5000 }, marketEstimate: 3000 });

    await userEvent.click(screen.getByRole("button", { name: /type your estimate/ }));
    await userEvent.clear(field());
    await userEvent.type(field(), "1,250 $M{Enter}");

    expect(onCommit).toHaveBeenCalledWith(1250);
  });

  it("puts a number on the option's grid", async () => {
    const { onCommit } = renderSlider(400);

    await userEvent.click(pill());
    await userEvent.clear(field());
    await userEvent.type(field(), "250.4{Enter}");

    expect(onCommit).toHaveBeenCalledWith(250);
    expect(screen.getByRole("status")).toHaveTextContent("Rounded to 250 $M.");
  });

  it("reads a lone comma as the decimal point", async () => {
    const percent = { ...scale, unit: "%", upperBound: 100 };
    const { onCommit } = renderSlider(40, { scale: percent, marketEstimate: 75 });

    await userEvent.click(pill());
    await userEvent.clear(field());
    await userEvent.type(field(), "7,5{Enter}");

    expect(onCommit).toHaveBeenCalledWith(8);
    expect(screen.getByRole("status")).toHaveTextContent("Rounded to 8 %.");
  });

  it("says nothing when a typed number is already on the grid", async () => {
    renderSlider(400);

    await userEvent.click(pill());
    await userEvent.clear(field());
    await userEvent.type(field(), "250{Enter}");

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("holds a number above the range to the top and says so", async () => {
    const { onCommit } = renderSlider(400);

    await userEvent.click(pill());
    await userEvent.clear(field());
    await userEvent.type(field(), "900{Enter}");

    expect(onCommit).toHaveBeenCalledWith(500);
    expect(screen.getByRole("status")).toHaveTextContent("The most is 500 $M.");
  });

  it("holds a number below the range to the bottom and says so", async () => {
    const { onCommit } = renderSlider(400);

    await userEvent.click(pill());
    await userEvent.clear(field());
    await userEvent.type(field(), "-20{Enter}");

    expect(onCommit).toHaveBeenCalledWith(0);
    expect(screen.getByRole("status")).toHaveTextContent("The least is 0 $M.");
  });

  it("names the saved value in the scale's own digits", async () => {
    const fine = { ...scale, unit: null, lowerBound: 0.1, upperBound: 0.6 };
    const { onCommit } = renderSlider(0.2, { scale: fine, marketEstimate: 0.3 });

    await userEvent.click(pill());
    await userEvent.clear(field());
    await userEvent.type(field(), "0.4567{Enter}");

    expect(onCommit).toHaveBeenCalledWith(0.457);
    expect(screen.getByRole("status")).toHaveTextContent("Rounded to 0.457.");
  });

  it("names the last point on the grid as the most, where the bound is between two", async () => {
    const ragged = { ...scale, upperBound: 123.456 };
    const { onCommit } = renderSlider(40, { scale: ragged, marketEstimate: 60 });

    await userEvent.click(pill());
    await userEvent.clear(field());
    await userEvent.type(field(), "999{Enter}");

    expect(onCommit).toHaveBeenCalledWith(123);
    expect(screen.getByRole("status")).toHaveTextContent("The most is 123 $M.");
  });

  it("refuses text that is not a number on Enter and keeps the field open", async () => {
    const { onCommit } = renderSlider(400);

    await userEvent.click(pill());
    await userEvent.clear(field());
    await userEvent.type(field(), "lots{Enter}");

    expect(onCommit).not.toHaveBeenCalled();
    expect(field()).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("Enter a number.");
  });

  it("refuses hex and exponent notation", async () => {
    const { onCommit } = renderSlider(400);

    for (const text of ["0x32", "1e2"]) {
      await userEvent.click(pill());
      await userEvent.clear(field());
      await userEvent.type(field(), `${text}{Enter}`);
      expect(screen.getByRole("status")).toHaveTextContent("Enter a number.");
      await userEvent.keyboard("{Escape}");
    }
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("is named by the value it shows, then what it does", () => {
    renderSlider(400);

    expect(screen.getByRole("button", { name: "400 $M, type your estimate for Greta Gerwig" })).toBeInTheDocument();
  });

  it("drops an open field when the slider locks, and does not reopen it when it unlocks", async () => {
    const props = {
      scale,
      marketEstimate: MARKET,
      isMarketPending: false,
      value: 400,
      onCommit: vi.fn(),
      onClear: vi.fn(),
    };
    const { rerender } = render(<EstimateSlider {...props} />);

    await userEvent.click(pill());
    rerender(<EstimateSlider {...props} lockedReason="A prediction is running." />);
    rerender(<EstimateSlider {...props} />);

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(pill()).toBeInTheDocument();
    expect(props.onCommit).not.toHaveBeenCalled();
  });

  it("keeps the estimate when the field loses focus holding no number", async () => {
    const { onCommit } = renderSlider(400);

    await userEvent.click(pill());
    await userEvent.clear(field());
    await userEvent.type(field(), "lots");
    await userEvent.tab();

    expect(onCommit).not.toHaveBeenCalled();
    expect(pill()).toHaveTextContent("400 $M");
  });

  it("clears the estimate when the market's own number is typed", async () => {
    const { onCommit, onClear } = renderSlider(400);

    await userEvent.click(pill());
    await userEvent.clear(field());
    await userEvent.type(field(), `${MARKET}{Enter}`);

    expect(onClear).toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("still shows a saved estimate on a locked slider, without offering to type it", () => {
    renderSlider(400, { lockedReason: "Trading has closed." });

    expect(screen.getByTestId("value-pill")).toHaveTextContent("400 $M");
    expect(screen.queryByRole("button", { name: /type your estimate/ })).toBeNull();
  });

  it("shows no value on a slider whose option has no trading", () => {
    renderSlider(undefined, { marketEstimate: undefined });

    expect(screen.queryByTestId("value-pill")).toBeNull();
  });

  it("is not offered while the slider is locked", () => {
    renderSlider(400, { lockedReason: "Trading has closed." });

    expect(screen.queryByRole("button", { name: /type your estimate/ })).toBeNull();
  });
});

describe("EstimateSlider note", () => {
  it("keeps an empty live region in place before any note", () => {
    renderSlider(400);

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  const refuse = async () => {
    await userEvent.click(pill());
    await userEvent.clear(field());
    await userEvent.type(field(), "lots{Enter}");
    expect(screen.getByRole("status")).toHaveTextContent("Enter a number.");
  };

  it("drops a refusal on Escape, bringing the hint back", async () => {
    renderSlider(400);
    await refuse();

    await userEvent.keyboard("{Escape}");

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(screen.getByText("88 $M above the market")).toBeInTheDocument();
  });

  it("drops a refusal when the field closes on a blur", async () => {
    renderSlider(400);
    await refuse();

    await userEvent.tab();

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(screen.getByText("88 $M above the market")).toBeInTheDocument();
  });

  const round = async () => {
    await userEvent.click(pill());
    await userEvent.clear(field());
    await userEvent.type(field(), "250.4{Enter}");
    expect(screen.getByRole("status")).toHaveTextContent("Rounded to 250 $M.");
    expect(pill()).toHaveFocus();
  };

  it("gives the line back to the hint once focus moves on", async () => {
    renderSlider(400);
    await round();

    await userEvent.tab();

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(screen.getByText("88 $M above the market")).toBeInTheDocument();
  });

  it("gives the line back to the hint at the next press", async () => {
    renderSlider(400);
    await round();

    await userEvent.click(document.body);

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("stays for a note applied by a blur, until the next press", async () => {
    renderSlider(400);
    await userEvent.click(pill());
    await userEvent.clear(field());
    await userEvent.type(field(), "250.4");

    await userEvent.click(document.body);
    expect(screen.getByRole("status")).toHaveTextContent("Rounded to 250 $M.");

    await userEvent.click(document.body);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});

describe("EstimateSlider hint", () => {
  it("says how far above the market the estimate sits", () => {
    renderSlider(400);

    expect(screen.getByText("88 $M above the market")).toBeInTheDocument();
  });

  it("says how far below the market the estimate sits", () => {
    renderSlider(250);

    expect(screen.getByText("62 $M below the market")).toBeInTheDocument();
  });

  it("says when the option has no trading", () => {
    renderSlider(undefined, { marketEstimate: undefined });

    expect(screen.getByText("No trading on this option yet.")).toBeInTheDocument();
  });

  it("says the market is loading", () => {
    renderSlider(undefined, { marketEstimate: undefined, isMarketPending: true });

    expect(screen.getByText("Loading the market…")).toBeInTheDocument();
  });
});
