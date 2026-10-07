import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { OptionScale } from "@/types/optionScale";

import type { PredictProgress } from "../../run/types";
import type { SelectedEstimate } from "../../types";
import { PredictDialog } from "../PredictDialog";

const scale = (market: string, name: string): OptionScale => ({
  market: market as `0x${string}`,
  name,
  color: "#009aff",
  unit: "$M",
  lowerBound: 0,
  upperBound: 500,
});

const GERWIG = "0xcccccccccccccccccccccccccccccccccccccccc";
const COOGLER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const selected: SelectedEstimate[] = [
  { scale: scale(GERWIG, "Greta Gerwig"), value: 400, marketEstimate: 312, direction: "higher" },
  { scale: scale(COOGLER, "Ryan Coogler"), value: 200, marketEstimate: 296, direction: "lower" },
];

const funds = { balance: 25_000000000000000000n, symbol: "sDAI", decimals: 18, isPending: false };

const progress = (overrides: Partial<PredictProgress> = {}): PredictProgress => ({
  stage: "quoting",
  steps: [
    { id: "deposit", label: "Add money to your trade wallet", state: "success" },
    { id: "predict-1", label: "Making your prediction", state: "running" },
  ],
  skipped: [],
  batchesDone: 0,
  batches: 1,
  ...overrides,
});

const props = () => ({
  isOpen: true,
  onClose: vi.fn(),
  selected,
  funds,
  progress: null,
  onRemove: vi.fn(),
  onConfirm: vi.fn(),
  onRetry: vi.fn(),
});

describe("confirming a prediction", () => {
  it("lists each estimate with which way it goes", () => {
    render(<PredictDialog {...props()} />);

    expect(screen.getByText("Greta Gerwig")).toBeInTheDocument();
    expect(screen.getByText(/↑ 400 \$M/)).toBeInTheDocument();
    expect(screen.getByText(/↓ 200 \$M/)).toBeInTheDocument();
  });

  it("says what the visitor has to spend", () => {
    render(<PredictDialog {...props()} />);

    expect(screen.getByText("You have 25 sDAI")).toBeInTheDocument();
  });

  it("hands back the amount in the token's own units", async () => {
    const onConfirm = vi.fn();
    render(<PredictDialog {...props()} onConfirm={onConfirm} />);

    await userEvent.type(screen.getByRole("textbox", { name: /Amount/ }), "5");
    await userEvent.click(screen.getByRole("button", { name: "Predict" }));

    expect(onConfirm).toHaveBeenCalledWith(5_000000000000000000n);
  });

  it("refuses an amount larger than the balance", async () => {
    const onConfirm = vi.fn();
    render(<PredictDialog {...props()} onConfirm={onConfirm} />);

    await userEvent.type(screen.getByRole("textbox", { name: /Amount/ }), "26");
    // the Kleros field re-parses what it shows on blur, so the value commits when focus leaves
    await userEvent.tab();

    expect(screen.getByText("That is more than you have.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Predict" })).toBeDisabled();
  });

  it("does not call a balance it has not read yet zero", () => {
    render(<PredictDialog {...props()} funds={{ ...funds, isPending: true }} />);

    expect(screen.getByText("Checking what you have")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Predict" })).toBeDisabled();
  });

  it("drops an estimate the visitor takes out here", async () => {
    const onRemove = vi.fn();
    render(<PredictDialog {...props()} onRemove={onRemove} />);

    await userEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]!);

    expect(onRemove).toHaveBeenCalledWith(GERWIG);
  });

  it("asks for a wallet at the moment of committing, not at the door", () => {
    render(<PredictDialog {...props()} notice="Connect a wallet to make this prediction." />);

    expect(screen.getByText("Connect a wallet to make this prediction.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Predict" })).toBeNull();
  });
});

describe("while a prediction runs", () => {
  it("names each step and what is happening now", () => {
    render(<PredictDialog {...props()} progress={progress()} />);

    expect(screen.getByText("Add money to your trade wallet")).toBeInTheDocument();
    expect(screen.getByText("finding the best prices")).toBeInTheDocument();
  });

  it("offers no way out part way through, which would abandon work already on chain", () => {
    render(<PredictDialog {...props()} progress={progress()} />);

    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("says it is waiting on a signature rather than on the chain", () => {
    render(<PredictDialog {...props()} progress={progress({ stage: "signing" })} />);

    expect(screen.getByText("waiting for your signature")).toBeInTheDocument();
  });

  it("says how many went through when only some did", () => {
    render(
      <PredictDialog
        {...props()}
        progress={progress({
          stage: "halted",
          batchesDone: 3,
          batches: 5,
          failure: { reason: "rejected" as const, retryable: true },
        })}
      />,
    );

    expect(screen.getByText("3 of 5 predictions went through. The rest did not.")).toBeInTheDocument();
    expect(screen.getByText(/Nothing is stuck/)).toBeInTheDocument();
    // the chain's own wording names gas and contracts, which §6 keeps off the screen
    expect(screen.getByText("You turned the request down.")).toBeInTheDocument();
  });

  it("offers the rest again, and only when trying again can help", async () => {
    const onRetry = vi.fn();
    const halted = { stage: "halted" as const, failure: { reason: "rejected" as const, retryable: true } };
    const { rerender } = render(<PredictDialog {...props()} progress={progress(halted)} onRetry={onRetry} />);

    await userEvent.click(screen.getByRole("button", { name: "Try the rest" }));
    expect(onRetry).toHaveBeenCalled();

    rerender(
      <PredictDialog
        {...props()}
        progress={progress({ stage: "halted", failure: { reason: "reverted" as const, retryable: false } })}
        onRetry={onRetry}
      />,
    );
    expect(screen.queryByRole("button", { name: "Try the rest" })).toBeNull();
  });

  it("says which estimates were left out", () => {
    render(<PredictDialog {...props()} progress={progress({ skipped: [GERWIG as `0x${string}`] })} />);

    expect(screen.getByText(/1 of your estimates could not be traded/)).toBeInTheDocument();
  });

  it("confirms plainly when it is done", () => {
    render(<PredictDialog {...props()} progress={progress({ stage: "complete" })} />);

    expect(screen.getByText("Done. Your estimates are on the market.")).toBeInTheDocument();
  });
});
