import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { OptionResult } from "@/features/resolution/utils/sessionResults";
import type { SessionOption } from "@/features/sessions/types";

import { addresses } from "@/testing/fixtures";

import { OptionCard } from "../OptionCard";

/** Spec D14: a result reads as plain text beside the option's name, not as a chip. */
vi.mock("@/components/ui/StatusChip", () => ({
  StatusChip: ({ label }: { label: string }) => <span data-testid="status-chip">{label}</span>,
}));

const option: SessionOption = {
  market: addresses.childMarkets[0],
  outcomeIndex: 1,
  name: "Greta Gerwig",
  color: "#009aff",
  question: "Share of the vote if Gerwig directs",
  unit: "%",
  lowerBound: 0,
  upperBound: 100,
  upToken: addresses.upToken,
  invalidToken: addresses.childInvalidToken,
  downToken: addresses.downToken,
  underlyingToken: addresses.underlyingToken,
  blocks: [],
};

function titleRow(result: OptionResult): HTMLElement {
  render(
    <OptionCard
      option={option}
      parentMarket={addresses.parentMarket}
      status="resolved"
      marketEstimate={50}
      isMarketPending={false}
      result={result}
    />,
  );
  return screen.getByRole("heading", { level: 3, name: option.name }).closest("button[aria-expanded]") as HTMLElement;
}

describe("OptionCard A1 shows its result as a text label beside the name", () => {
  it.each<{ label: string; result: OptionResult }>([
    { label: "Result 42 %", result: { kind: "final", text: "42 %", share: 0.42 } },
    { label: "Not selected", result: { kind: "not-selected" } },
    { label: "Waiting for result", result: { kind: "waiting" } },
    { label: "Invalid", result: { kind: "invalid", payouts: "Pays per token: UP 0, DOWN 0, INVALID 1" } },
  ])("$label reads as text in the title row, with no status chip", ({ label, result }) => {
    const row = titleRow(result);

    expect(row).toHaveTextContent(option.name);
    expect(row).toHaveTextContent(label);
    expect(row.querySelector("[data-testid='status-chip']")).toBeNull();
  });
});
