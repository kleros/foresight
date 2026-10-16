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
  it("says to confirm in the wallet while the deposit waits on a signature, then says it is confirming", () => {
    const { rerender } = render(timeline(depositing("signing")));

    expect(item("Add funds").querySelector("h2 + p")?.textContent).toBe("Confirm in your wallet");

    rerender(timeline(depositing("confirming")));

    expect(item("Add funds").querySelector("h2 + p")?.textContent).toBe("Confirming…");
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
  // the pulse itself is checked in a browser: e2e/tests/predict-popup-layout.spec.ts, "the running step"
  it("marks the running step's bullet, and adds nothing beside it", () => {
    render(timeline(depositing("signing")));

    expect(bullet("Add funds")).toBe("running");
    expect(within(item("Add funds")).queryByLabelText("Timeline item party element")).toBeNull();
  });

  it("checks a finished step and keeps it at full strength", () => {
    render(timeline(depositing("signing")));

    expect(bullet("Trade wallet")).toBe("done");
    expect(item("Trade wallet")).not.toHaveClass("opacity-50");
  });

  it("keeps each bullet's element through a change of view, so its glyphs can cross-fade", () => {
    const view = render(timeline(depositing("signing")));
    const before = item("Add funds").querySelector("[data-bullet]");

    view.rerender(timeline(halted));

    expect(item("Add funds").querySelector("[data-bullet]")).toBe(before);
    expect(before?.querySelectorAll("[data-glyph]")).toHaveLength(3);
  });

  it("numbers the steps 1 to 3 in their bullets", () => {
    render(timeline(depositing("signing")));

    expect(
      screen.getAllByRole("listitem").map((row) => row.querySelector('[data-glyph="digit"]')?.textContent),
    ).toEqual(["1", "2", "3"]);
  });

  it("puts a step's detail on its title's line, in the timeline's party slot", () => {
    render(timeline(depositing("signing")));

    expect(within(item("Add funds")).getByLabelText("Timeline item party: Confirm in your wallet")).toBeVisible();
    expect(item("Add funds").querySelector("small")?.textContent).toBe("");
  });

  it("crosses the step that stopped the run, in place, with no row added", () => {
    render(timeline(halted));

    expect(bullet("Place prediction")).toBe("failed");
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });
});

describe("the timeline's place in the popup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /** The timeline scrolls a frame after it renders. */
  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

  /** jsdom has no matchMedia; this one answers only the reduced-motion query, as `reduce` says. */
  const prefersReducedMotion = (reduce: boolean) =>
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: reduce && query === "(prefers-reduced-motion: reduce)",
      media: query,
    }));

  it.each([
    [false, "smooth"],
    [true, "auto"],
  ])("with reduced motion %s, scrolls to a running step with behaviour %s", async (reduce, behavior) => {
    prefersReducedMotion(reduce);
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;

    render(
      <PredictStepsTimeline
        steps={{ rows: [{ key: "predict", title: "Place prediction", subtitle: "", view: "running" }] }}
      />,
    );
    await nextFrame();

    expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: "nearest", behavior });
  });

  it("scrolls itself into view when a run stops with a failure", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const view = render(
      <PredictStepsTimeline
        steps={{ rows: [{ key: "predict", title: "Place prediction", subtitle: "", view: "idle" }] }}
      />,
    );
    await nextFrame();
    expect(scroll).not.toHaveBeenCalled();

    view.rerender(
      <PredictStepsTimeline
        steps={{
          rows: [{ key: "predict", title: "Place prediction", subtitle: "", view: "inactive" }],
          failure: "Something went wrong.",
        }}
      />,
    );
    await nextFrame();

    expect(scroll).toHaveBeenCalledTimes(1);
  });
});
