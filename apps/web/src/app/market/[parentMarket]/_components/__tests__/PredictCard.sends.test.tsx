import type { ReactNode } from "react";

import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PredictSnapshot } from "@/features/predict/flow/types";
import { useEstimateStore } from "@/features/predict/stores/estimateStore";
import type { SelectedEstimate } from "@/features/predict/types";
import type { SessionDetail } from "@/features/sessions/types";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";
import { toSessionDetail } from "@/features/sessions/utils/toSessionDetail";

import { GATEWAY } from "@/testing/fixtures";

import { PredictCard } from "../PredictCard";

const runner = vi.hoisted(() => ({ props: [] as Array<Record<string, unknown>> }));
vi.mock("next/dynamic", () => ({
  default: () => (props: Record<string, unknown>) => {
    if ("selected" in props) runner.props.push(props);
    return null;
  },
}));
vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: "0xa11ce000000000000000000000000000000a11ce" }),
}));
vi.mock("@/components/wallet/EnsureChain", () => ({ default: ({ children }: { children: ReactNode }) => children }));
const stored = vi.hoisted(() => ({ run: null as Partial<PredictSnapshot> | null }));
vi.mock("@/features/predict/run/interrupted", () => ({
  findInterruptedRun: () => stored.run,
  hasPendingTransaction: () => false,
  discardRun: () => undefined,
}));

const MARKETS = ["0x1111", "0x2222"].map((head) => head.padEnd(42, head.slice(-1)));
const detail: SessionDetail = toSessionDetail(
  {
    ...sessionDetailColumns,
    id: "7",
    outcomeCount: "2",
    deployedChildCount: "2",
    children: ["Berlin", "Lisbon"].map((name, index) =>
      sessionChildRow({ id: MARKETS[index], parentOutcomeIndex: String(index), displayName: name }),
    ),
  },
  GATEWAY,
);
const marketEstimates = Object.fromEntries(detail.options.map((option) => [option.market.toLowerCase(), 250]));

function renderCard() {
  detail.options.forEach((option, index) =>
    useEstimateStore.getState().setEstimate(detail.parentMarket, option.market, [400, 120][index]!),
  );
  const slot = document.createElement("div");
  document.body.append(slot);
  render(<PredictCard session={detail} status="trading" marketEstimates={marketEstimates} barSlot={slot} />);
  return slot;
}

beforeEach(() => {
  window.localStorage.clear();
  runner.props.length = 0;
  stored.run = null;
  useEstimateStore.getState().resetEstimates(detail.parentMarket);
  document.body.replaceChildren();
});

describe("what the predict card shows against what Predict sends", () => {
  it("after a placed run, names only the pick changed since, as Predict sends", async () => {
    const user = userEvent.setup();
    const slot = renderCard();
    await user.click(screen.getByRole("button", { name: "Predict 2 estimates" }));
    act(() => (runner.props.at(-1)!.onSuccess as (leftOut: string[], run: unknown) => void)([], {}));

    act(() => useEstimateStore.getState().setEstimate(detail.parentMarket, detail.options[0]!.market, 410));

    const chips = within(screen.getByRole("list", { name: "Your estimates" })).getAllByRole("listitem");
    expect(chips.map((chip) => chip.textContent)).toEqual(["Berlin410 $M"]);
    expect(within(slot).getByText("1 estimate · Berlin")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Predict 1 estimate" }));
    const sent = runner.props.at(-1)!.selected as SelectedEstimate[];
    expect(sent.map((estimate) => estimate.scale.name)).toEqual(["Berlin"]);
  });

  it("shows no picks and no bar while an unfinished run is stored, which Predict reopens", async () => {
    stored.run = { deposit: 0n, creditsToSpend: 0n };
    const slot = renderCard();

    await screen.findByRole("button", { name: "Resume" });
    expect(screen.queryByRole("list", { name: "Your estimates" })).toBeNull();
    expect(slot).toBeEmptyDOMElement();
  });
});
