import { useState } from "react";

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

  it("hands the removal over at once and lets the row fade out before it leaves the list", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onRemove = vi.fn();
    const { rerender } = render(<PredictList selected={[estimate, other]} onRemove={onRemove} isReadOnly={false} />);

    await userEvent.click(screen.getByRole("button", { name: "Remove Movie A" }));
    expect(onRemove).toHaveBeenCalledExactlyOnceWith(market);
    rerender(<PredictList selected={[other]} onRemove={onRemove} isReadOnly={false} />);
    expect(screen.getByText("Movie A").closest("li")).toHaveAttribute("data-leaving");
    expect(screen.getAllByRole("listitem").map((row) => row.textContent)).toEqual(["Movie A87 %", "Movie B87 %"]);

    act(() => vi.advanceTimersByTime(100));
    expect(screen.queryByText("Movie A")).toBeNull();
  });

  it("takes the exit's length from the motion token", () => {
    vi.useFakeTimers();
    document.documentElement.style.setProperty("--fs-dur-echo", "0.25s");
    const { rerender } = render(<PredictList selected={[estimate, other]} onRemove={vi.fn()} isReadOnly={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove Movie A" }));
    rerender(<PredictList selected={[other]} onRemove={vi.fn()} isReadOnly={false} />);
    act(() => vi.advanceTimersByTime(249));
    expect(screen.getByText("Movie A")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText("Movie A")).toBeNull();
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

  it("keeps a row still fading in its place once a row above it, removed first, has left", () => {
    vi.useFakeTimers();
    const rows = ["Movie A", "Movie B", "Movie C", "Movie D"].map((name, index) => ({
      ...estimate,
      scale: { ...estimate.scale, market: `0x${String(index + 1).repeat(40)}` as typeof market, name },
    }));
    function Popup() {
      const [removed, setRemoved] = useState<string[]>([]);
      return (
        <PredictList
          selected={rows.filter((row) => !removed.includes(row.scale.market))}
          onRemove={(gone) => setRemoved((markets) => [...markets, gone])}
          isReadOnly={false}
        />
      );
    }
    render(<Popup />);
    const order = () => screen.getAllByRole("listitem").map((row) => row.querySelector("span[title]")?.textContent);

    fireEvent.click(screen.getByRole("button", { name: "Remove Movie B" }));
    act(() => vi.advanceTimersByTime(40));
    fireEvent.click(screen.getByRole("button", { name: "Remove Movie C" }));
    // B's exit ends while C has 40ms left to fade where it was shown
    act(() => vi.advanceTimersByTime(60));

    expect(order()).toEqual(["Movie A", "Movie C", "Movie D"]);
  });

  it("leaves a removed estimate out of a run started during its exit", () => {
    vi.useFakeTimers();
    const taken: string[][] = [];
    function Popup() {
      const [removed, setRemoved] = useState<string[]>([]);
      const [running, setRunning] = useState(false);
      const kept = [estimate, other].filter((row) => !removed.includes(row.scale.market));
      return (
        <>
          <PredictList
            selected={kept}
            onRemove={(gone) => setRemoved((markets) => [...markets, gone])}
            isReadOnly={running}
          />
          <button
            onClick={() => {
              taken.push(kept.map((row) => row.scale.name));
              setRunning(true);
            }}
          >
            Predict
          </button>
        </>
      );
    }
    render(<Popup />);

    fireEvent.click(screen.getByRole("button", { name: "Remove Movie A" }));
    act(() => vi.advanceTimersByTime(50));
    fireEvent.click(screen.getByRole("button", { name: "Predict" }));
    act(() => vi.advanceTimersByTime(200));

    expect(taken).toEqual([["Movie B"]]);
    expect(screen.queryByText("Movie A")).toBeNull();
  });
});
