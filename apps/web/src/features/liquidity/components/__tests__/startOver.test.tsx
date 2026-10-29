import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { LiquidityRun } from "../../hooks/useLiquidityRun";
import type { LiquidityProgress } from "../../types";
import { START_OVER_WARNING } from "../../utils/runSteps";
import { LiquidityPopupFooter } from "../LiquidityPopupFooter";
import { LiquidityRunStatus } from "../LiquidityRunStatus";

const held: LiquidityProgress = {
  stage: "halted",
  failure: { reason: "held", retryable: true },
  kind: "seed",
  holdsSend: true,
  rows: [],
  signatures: { done: 2, total: 5 },
};
const declined: LiquidityProgress = { ...held, failure: { reason: "rejected", retryable: true }, holdsSend: undefined };

function runAt(progress: LiquidityProgress) {
  return {
    progress,
    start: vi.fn(),
    resume: vi.fn(),
    retry: vi.fn(),
    reset: vi.fn(),
    discard: vi.fn(),
    isRunning: false,
    isHeld: true,
  } satisfies LiquidityRun;
}

const footer = (run: LiquidityRun) => (
  <LiquidityPopupFooter run={run} isOwn idle={{ text: "Add liquidity", isDisabled: false, onPress: () => {} }} />
);

describe.each([
  ["the popup's footer", footer],
  ["the section's run status", (run: LiquidityRun) => <LiquidityRunStatus run={run} onReview={() => {}} />],
])("Start over in %s", (_, view) => {
  it("asks the user to reject the open prompt before it lets go of a held send, and only then discards", async () => {
    const run = runAt(held);
    render(view(run));

    await userEvent.click(screen.getByRole("button", { name: "Start over" }));

    expect(screen.getByRole("alert")).toHaveTextContent(START_OVER_WARNING);
    expect(run.discard).not.toHaveBeenCalled();
    expect(run.reset).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Start over" }));
    expect(run.discard).toHaveBeenCalledTimes(1);
    expect(run.reset).not.toHaveBeenCalled();
  });

  it("goes back without discarding", async () => {
    const run = runAt(held);
    render(view(run));

    await userEvent.click(screen.getByRole("button", { name: "Start over" }));
    await userEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
    expect(run.discard).not.toHaveBeenCalled();
  });

  it("asks again on a later hold, not carrying an earlier press over a run that went on", async () => {
    const run = runAt(held);
    const { rerender } = render(view(run));
    await userEvent.click(screen.getByRole("button", { name: "Start over" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    rerender(view({ ...run, progress: { ...held, stage: "signing", failure: undefined, holdsSend: undefined } }));
    rerender(view(run));

    expect(screen.queryByRole("alert")).toBeNull();
    expect(run.discard).not.toHaveBeenCalled();
  });

  it("offers no Start over on a run whose batch the wallet cannot report (L9)", () => {
    const run = runAt({ ...held, failure: { reason: "batch-unknown", retryable: false } });
    render(view(run));

    expect(screen.queryByRole("button", { name: "Start over" })).toBeNull();
  });

  it("forgets a run that holds no send at once, without asking", async () => {
    const run = runAt(declined);
    render(view(run));

    await userEvent.click(screen.getByRole("button", { name: "Start over" }));

    expect(run.reset).toHaveBeenCalledTimes(1);
    expect(run.discard).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
