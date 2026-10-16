import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addresses } from "@/testing/fixtures";

import { PredictList, type ListedEstimate } from "../PredictList";

const market = addresses.childMarkets[0];
const estimate: ListedEstimate = {
  scale: { market, name: "Movie A", color: "#009aff", unit: "%", lowerBound: 0, upperBound: 100 },
  value: 87,
  marketEstimate: 75,
  direction: "higher",
};

const list = (selected: ListedEstimate[] = [estimate]) =>
  render(<PredictList selected={selected} onRemove={vi.fn()} isReadOnly={false} />);

describe("PredictList's rows", () => {
  it("reads each estimate as its name, its value and an arrow for which side of the market it is on", () => {
    list();
    const row = screen.getByRole("listitem");

    expect(within(row).getByText("Movie A")).toBeInTheDocument();
    expect(within(row).getByText("87 %")).toBeInTheDocument();
    expect(within(row).getByRole("img", { name: "above the market" })).toBeInTheDocument();
    expect(row).not.toHaveTextContent(/than the market/);
  });

  it("keeps the market's move off the row, which has one right edge", () => {
    list();

    expect(screen.getByRole("listitem")).toHaveTextContent(/^Movie A87 %$/);
  });

  it("carries the full name in a title, for when it is cut short", () => {
    list();

    expect(screen.getByText("Movie A")).toHaveAttribute("title", "Movie A");
  });
});

describe("removing a row", () => {
  const other = { ...estimate, scale: { ...estimate.scale, market: addresses.childMarkets[1], name: "Movie B" } };
  // jsdom loads no stylesheet, so the exit's duration token is set where the list reads it
  beforeEach(() => document.documentElement.style.setProperty("--fs-dur-echo", "100ms"));
  afterEach(() => {
    vi.useRealTimers();
    document.documentElement.style.removeProperty("--fs-dur-echo");
  });

  it("lets the row fade out before it leaves the list", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onRemove = vi.fn();
    render(<PredictList selected={[estimate, other]} onRemove={onRemove} isReadOnly={false} />);

    await userEvent.click(screen.getByRole("button", { name: "Remove Movie A" }));
    expect(screen.getByText("Movie A").closest("li")).toHaveAttribute("data-leaving");
    expect(onRemove).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(100));
    expect(onRemove).toHaveBeenCalledExactlyOnceWith(market);
  });

  it("takes the exit's length from the motion token", () => {
    vi.useFakeTimers();
    document.documentElement.style.setProperty("--fs-dur-echo", "0.25s");
    const onRemove = vi.fn();
    render(<PredictList selected={[estimate, other]} onRemove={onRemove} isReadOnly={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove Movie A" }));
    act(() => vi.advanceTimersByTime(249));
    expect(onRemove).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onRemove).toHaveBeenCalledExactlyOnceWith(market);
  });

  it("keeps the last row when both are removed within one exit", () => {
    vi.useFakeTimers();
    const onRemove = vi.fn();
    render(<PredictList selected={[estimate, other]} onRemove={onRemove} isReadOnly={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove Movie A" }));
    act(() => vi.advanceTimersByTime(50));
    expect(screen.getByRole("button", { name: "Remove Movie B" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Remove Movie B" }));
    act(() => vi.advanceTimersByTime(200));

    expect(onRemove).toHaveBeenCalledExactlyOnceWith(market);
  });

  it("keeps a row whose exit is overtaken by a run starting", () => {
    vi.useFakeTimers();
    const onRemove = vi.fn();
    const { rerender } = render(<PredictList selected={[estimate, other]} onRemove={onRemove} isReadOnly={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove Movie A" }));
    rerender(<PredictList selected={[estimate, other]} onRemove={onRemove} isReadOnly />);
    act(() => vi.advanceTimersByTime(200));

    expect(onRemove).not.toHaveBeenCalled();
  });
});
