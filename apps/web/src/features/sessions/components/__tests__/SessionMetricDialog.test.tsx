import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
      <SessionMetricDialog kind="volume" onClose={onClose} metrics={metrics} symbol="sDAI" usdPrice={undefined} />
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
        <SessionMetricDialog kind="volume" onClose={onClose} metrics={metrics} symbol="sDAI" usdPrice={undefined} />
      </>,
    );

    await userEvent.keyboard("{Escape}");

    expect(screen.getByRole("button", { name: "Volume" })).toHaveFocus();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("says no pool yet for an option without pools", () => {
    open();

    expect(screen.getByText("No pool yet.")).toBeInTheDocument();
  });
});
