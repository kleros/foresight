import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseEther, parseUnits } from "viem";
import { describe, expect, it, vi } from "vitest";

import { addresses } from "@/testing/fixtures";

import type { SessionMetrics } from "../../utils/sessionMetrics";
import { SessionMetricDialog } from "../SessionMetricDialog";

const metrics: SessionMetrics = {
  volume: 3,
  notional: 4,
  liquidity: null,
  options: [
    { market: addresses.childMarkets[0]!, name: "Option A", volume: 3, notional: 4, liquidity: null, pools: [] },
  ],
};

function open() {
  const onClose = vi.fn();
  render(
    <>
      <button type="button">Volume</button>
      <SessionMetricDialog
        kind="volume"
        onClose={onClose}
        opener={{ current: null }}
        metrics={metrics}
        symbol="sDAI"
        decimals={18}
        usdPrice={undefined}
      />
    </>,
  );
  return onClose;
}

describe("SessionMetricDialog", () => {
  it("takes focus when it opens", () => {
    open();

    expect(screen.getByRole("dialog", { name: "Volume" })).toHaveFocus();
  });

  it("closes on Escape", async () => {
    const onClose = open();

    await userEvent.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on a press outside it, not on one inside it", () => {
    const onClose = open();

    fireEvent.mouseDown(screen.getByText("Option A"));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(screen.getByRole("button", { name: "Volume" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("hands focus back to what opened it when closed from inside", async () => {
    const onClose = vi.fn();
    const { rerender } = render(<button type="button">Volume</button>);
    screen.getByRole("button", { name: "Volume" }).focus();
    rerender(
      <>
        <button type="button">Volume</button>
        <SessionMetricDialog
          kind="volume"
          onClose={onClose}
          opener={{ current: screen.getByRole("button", { name: "Volume" }) }}
          metrics={metrics}
          symbol="sDAI"
          decimals={18}
          usdPrice={undefined}
        />
      </>,
    );

    await userEvent.keyboard("{Escape}");

    expect(screen.getByRole("button", { name: "Volume" })).toHaveFocus();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("hands focus back to what opened it on Escape when focus was lost to the page", async () => {
    const onClose = vi.fn();
    const { rerender } = render(<button type="button">Volume</button>);
    rerender(
      <>
        <button type="button">Volume</button>
        <SessionMetricDialog
          kind="volume"
          onClose={onClose}
          opener={{ current: screen.getByRole("button", { name: "Volume" }) }}
          metrics={metrics}
          symbol="sDAI"
          decimals={18}
          usdPrice={undefined}
        />
      </>,
    );
    screen.getByRole("dialog", { name: "Volume" }).blur();
    expect(document.body).toHaveFocus();

    await userEvent.keyboard("{Escape}");

    expect(screen.getByRole("button", { name: "Volume" })).toHaveFocus();
  });

  it("stays open on an Escape another handler on the page already took", async () => {
    const onClose = vi.fn();
    render(
      <>
        <input
          aria-label="Search"
          onKeyDown={(event) => {
            if (event.key === "Escape") event.preventDefault();
          }}
        />
        <SessionMetricDialog
          kind="volume"
          onClose={onClose}
          opener={{ current: null }}
          metrics={metrics}
          symbol="sDAI"
          decimals={18}
          usdPrice={undefined}
        />
      </>,
    );
    screen.getByRole("textbox", { name: "Search" }).focus();

    await userEvent.keyboard("{Escape}");

    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on an Escape another handler on the page saw and left unhandled", async () => {
    const onClose = vi.fn();
    const sawEscape = vi.fn();
    render(
      <>
        <input
          aria-label="Search"
          onKeyDown={(event) => {
            if (event.key === "Escape") sawEscape();
          }}
        />
        <SessionMetricDialog
          kind="volume"
          onClose={onClose}
          opener={{ current: null }}
          metrics={metrics}
          symbol="sDAI"
          decimals={18}
          usdPrice={undefined}
        />
      </>,
    );
    screen.getByRole("textbox", { name: "Search" }).focus();

    await userEvent.keyboard("{Escape}");

    expect(sawEscape).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on Escape after focus has moved out of it", async () => {
    const onClose = open();
    screen.getByRole("button", { name: "Volume" }).focus();

    await userEvent.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("leaves focus where it was moved when Escape closes it from outside", async () => {
    const onClose = vi.fn();
    const { rerender } = render(<button type="button">Volume</button>);
    const opener = screen.getByRole("button", { name: "Volume" });
    rerender(
      <>
        <button type="button">Volume</button>
        <button type="button">Elsewhere</button>
        <SessionMetricDialog
          kind="volume"
          onClose={onClose}
          opener={{ current: opener }}
          metrics={metrics}
          symbol="sDAI"
          decimals={18}
          usdPrice={undefined}
        />
      </>,
    );
    screen.getByRole("button", { name: "Elsewhere" }).focus();

    await userEvent.keyboard("{Escape}");

    expect(screen.getByRole("button", { name: "Elsewhere" })).toHaveFocus();
  });

  it("says no pool yet for an option without pools", () => {
    open();

    expect(screen.getByText("No pool yet.")).toBeInTheDocument();
  });

  // every figure distinct, so a line or block that shows the wrong one finds no match
  const breakdown: SessionMetrics = {
    volume: 100,
    notional: 200,
    liquidity: 300,
    options: [
      {
        market: addresses.childMarkets[0]!,
        name: "Option A",
        volume: 11,
        notional: 12,
        liquidity: 13,
        pools: [
          {
            side: "UP",
            volume: 1.5,
            notional: 2.5,
            liquidity: { outcome: parseEther("40"), underlying: parseEther("12.5"), priced: true, value: 7.25 },
          },
          {
            side: "DOWN",
            volume: 3.5,
            notional: 4.5,
            liquidity: { outcome: parseEther("20"), underlying: parseEther("6"), priced: false, value: 5.75 },
          },
        ],
      },
      {
        market: addresses.childMarkets[1]!,
        name: "Option B",
        volume: 21,
        notional: 22,
        liquidity: 23,
        pools: [],
      },
    ],
  };

  const show = (kind: "volume" | "notional" | "liquidity") =>
    render(
      <SessionMetricDialog
        kind={kind}
        onClose={vi.fn()}
        opener={{ current: null }}
        metrics={breakdown}
        symbol="sDAI"
        decimals={18}
        usdPrice={undefined}
      />,
    );
  const block = (name: string) => screen.getByText(name).closest("section")!;
  const line = (option: string, side: string) =>
    within(block(option))
      .getAllByRole("listitem")
      .find((item) => item.textContent?.includes(side))!;

  it.each([
    ["volume", "~11 sDAI", "~21 sDAI"],
    ["notional", "~12 sDAI", "~22 sDAI"],
    ["liquidity", "~13 sDAI", "~23 sDAI"],
  ] as const)("heads each option's %s block with that option's own figure", (kind, first, second) => {
    show(kind);

    expect(within(block("Option A")).getByText(first)).toBeInTheDocument();
    expect(within(block("Option B")).getByText(second)).toBeInTheDocument();
  });

  it("shows each pool's own volume and notional volume on its line", () => {
    const { unmount } = show("volume");
    expect(line("Option A", "UP")).toHaveTextContent("~1.5 sDAI");
    expect(line("Option A", "DOWN")).toHaveTextContent("~3.5 sDAI");
    unmount();

    show("notional");
    expect(line("Option A", "UP")).toHaveTextContent("~2.5 sDAI");
    expect(line("Option A", "DOWN")).toHaveTextContent("~4.5 sDAI");
  });

  it("shows each pool's holdings and their value on its liquidity line, priced or not", () => {
    show("liquidity");

    expect(line("Option A", "UP")).toHaveTextContent("40 UP / 12.5 underlying");
    expect(line("Option A", "UP")).toHaveTextContent("~7.25 sDAI");
    expect(line("Option A", "DOWN")).toHaveTextContent("20 DOWN / 6 underlying");
    expect(line("Option A", "DOWN")).toHaveTextContent("~5.75 sDAI");
  });

  it("marks an unpriced pool on its line whichever side it is", () => {
    show("liquidity");

    expect(line("Option A", "DOWN")).toHaveTextContent(/not priced yet/);
    expect(line("Option A", "UP")).not.toHaveTextContent(/not priced yet/);
  });

  it("reads a pool's holdings in the collateral's decimals", () => {
    // a 6-decimal collateral, whose outcome and underlying tokens share its decimals
    const sixDecimals: SessionMetrics = {
      ...breakdown,
      options: [
        {
          ...breakdown.options[0]!,
          pools: [
            {
              side: "UP",
              volume: 1.5,
              notional: 2.5,
              liquidity: { outcome: parseUnits("40", 6), underlying: parseUnits("12.5", 6), priced: true, value: 7.25 },
            },
          ],
        },
      ],
    };
    render(
      <SessionMetricDialog
        kind="liquidity"
        onClose={vi.fn()}
        opener={{ current: null }}
        metrics={sixDecimals}
        symbol="USDC"
        decimals={6}
        usdPrice={undefined}
      />,
    );

    expect(line("Option A", "UP")).toHaveTextContent("40 UP / 12.5 underlying");
  });

  it("gives no USD figure while the collateral has no USD price, as when its read failed", () => {
    show("volume");

    expect(screen.getByRole("dialog", { name: "Volume" }).textContent).not.toMatch(/\$/);
  });
});
