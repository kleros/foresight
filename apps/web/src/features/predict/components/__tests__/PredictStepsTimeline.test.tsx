import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PredictProgress } from "../../run/types";
import { predictSteps } from "../../utils/predictSteps";
import { PredictStepsTimeline } from "../PredictStepsTimeline";

const WALLET = "0xdcee0000000000000000000000000000000c664f" as const;
const WAD = 10n ** 18n;

const depositing = (stage: PredictProgress["stage"]): PredictProgress => ({
  stage,
  steps: [
    { id: "create-wallet", label: "", state: "success" },
    { id: "deposit", label: "", state: "running" },
    { id: "predict-1", label: "", state: "pending" },
  ],
  skipped: [],
  batchesDone: 0,
  batches: 1,
});

const timeline = (progress: PredictProgress) => (
  <PredictStepsTimeline
    steps={predictSteps({
      wallet: { address: WALLET, deployed: true },
      toAdd: 4n * WAD,
      symbol: "sDAI",
      decimals: 18,
      progress,
    })}
  />
);

describe("PredictStepsTimeline while adding funds", () => {
  it("moves from waiting for a signature to confirming once the deposit is signed", () => {
    const { rerender } = render(timeline(depositing("signing")));

    expect(screen.getByText("Add funds to your trade wallet")).toBeInTheDocument();
    expect(screen.getByText(/Waiting for your signature…/)).toBeInTheDocument();

    rerender(timeline(depositing("confirming")));

    expect(screen.getByText(/Confirming…/)).toBeInTheDocument();
    expect(screen.queryByText(/Waiting for your signature…/)).toBeNull();
  });
});

const halted: PredictProgress = {
  stage: "halted",
  steps: [
    { id: "create-wallet", label: "", state: "success" },
    { id: "deposit", label: "", state: "success" },
    { id: "predict-1", label: "", state: "error" },
  ],
  skipped: [],
  batchesDone: 0,
  batches: 1,
  failure: { reason: "rejected", retryable: true },
};

const item = (title: string) => screen.getByRole("listitem", { name: `Timeline item: ${title}` });
const bullet = (title: string) => item(title).querySelector("[data-bullet]")?.getAttribute("data-bullet");

describe("PredictStepsTimeline bullets", () => {
  it("draws the running step with futarchy's ring and a spinner", () => {
    render(timeline(depositing("signing")));

    expect(bullet("Add funds to your trade wallet")).toBe("running");
    expect(within(item("Add funds to your trade wallet")).getByTestId("step-spinner")).toBeInTheDocument();
  });

  it("checks a finished step and keeps it at full strength", () => {
    render(timeline(depositing("signing")));

    expect(bullet("Trade wallet")).toBe("done");
    expect(item("Trade wallet")).not.toHaveClass("opacity-50");
  });

  it("crosses the step that stopped the run, in place, with no row added", () => {
    render(timeline(halted));

    expect(bullet("Make prediction")).toBe("failed");
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });
});

describe("the timeline's place in the popup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("scrolls itself into view when a run stops with a failure", () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const view = render(
      <PredictStepsTimeline
        steps={{ rows: [{ key: "predict", title: "Make prediction", subtitle: "", view: "idle" }] }}
      />,
    );
    expect(scroll).not.toHaveBeenCalled();

    view.rerender(
      <PredictStepsTimeline
        steps={{
          rows: [{ key: "predict", title: "Make prediction", subtitle: "", view: "inactive" }],
          failure: "Something went wrong.",
        }}
      />,
    );

    expect(scroll).toHaveBeenCalledTimes(1);
  });
});
