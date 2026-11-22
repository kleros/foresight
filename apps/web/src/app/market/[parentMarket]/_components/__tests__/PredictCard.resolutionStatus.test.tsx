import type { ReactNode } from "react";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PredictSnapshot } from "@/features/predict/flow/types";
import { useEstimateStore } from "@/features/predict/stores/estimateStore";
import type { SessionDetail, SessionStatus } from "@/features/sessions/types";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";
import { toSessionDetail } from "@/features/sessions/utils/toSessionDetail";

import { GATEWAY } from "@/testing/fixtures";

import { PredictCard } from "../PredictCard";

/** Under status resolved or unknown the card says why Predict is off, and a stored run can still be reopened. */

const runner = vi.hoisted(() => ({ props: [] as Array<Record<string, unknown>> }));
vi.mock("next/dynamic", () => ({
  default: () => (props: Record<string, unknown>) => {
    if ("selected" in props) runner.props.push(props);
    return null;
  },
}));
const wallet = vi.hoisted(() => ({ address: undefined as Address | undefined }));
vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: wallet.address, chainId: 100 }),
}));
vi.mock("@/components/wallet/EnsureChain", () => ({ default: ({ children }: { children: ReactNode }) => children }));
const stored = vi.hoisted(() => ({ run: null as Partial<PredictSnapshot> | null, pending: false }));
vi.mock("@/features/predict/run/interrupted", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/predict/run/interrupted")>()),
  findInterruptedRun: () => stored.run,
  hasPendingTransaction: () => stored.pending,
  discardRun: () => undefined,
}));

const OWNER = "0xa11ce000000000000000000000000000000a11ce" as Address;
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

const UNKNOWN = /Couldn't check whether this session has resolved/;
const REASON: Record<"resolved" | "unknown", RegExp> = { resolved: /resolved/i, unknown: UNKNOWN };

function renderCard(status: SessionStatus) {
  detail.options.forEach((option, index) =>
    useEstimateStore.getState().setEstimate(detail.parentMarket, option.market, [400, 120][index]!),
  );
  const ui = (at: SessionStatus) => (
    <PredictCard session={detail} status={at} marketEstimates={marketEstimates} hasLiquidity />
  );
  const view = render(ui(status));
  return { ...view, rerenderAt: (at: SessionStatus) => view.rerender(ui(at)) };
}

const predictButtons = () => screen.queryAllByRole("button", { name: /^Predict/ });

beforeEach(() => {
  window.localStorage.clear();
  runner.props.length = 0;
  stored.run = null;
  stored.pending = false;
  wallet.address = OWNER;
  useEstimateStore.getState().resetEstimates(detail.parentMarket);
  document.body.replaceChildren();
});

describe.each(["resolved", "unknown"] as const)("A8 the predict card under status %s", (status) => {
  it("turns Predict off and says why", async () => {
    renderCard(status);

    await screen.findByText(REASON[status]);
    expect(predictButtons().length).toBeGreaterThan(0);
    for (const button of predictButtons()) expect(button).toBeDisabled();
  });

  it("still says why with no wallet connected", async () => {
    wallet.address = undefined;
    renderCard(status);

    expect(await screen.findByText(REASON[status])).toBeInTheDocument();
    expect(screen.queryByText("Connect a wallet to predict.")).toBeNull();
  });

  it("turns a live Predict off, with the reason, when the status changes", async () => {
    const view = renderCard("trading");
    await screen.findByRole("button", { name: "Predict 2 estimates" });
    expect(screen.getByRole("button", { name: "Predict 2 estimates" })).toBeEnabled();

    view.rerenderAt(status);

    expect(await screen.findByText(REASON[status])).toBeInTheDocument();
    for (const button of predictButtons()) expect(button).toBeDisabled();
  });

  it("opens a stored run with a transaction in flight, so it can be inspected and recovered", async () => {
    stored.run = { deposit: 0n, creditsToSpend: 0n };
    stored.pending = true;
    renderCard(status);

    const resume = await screen.findByRole("button", { name: "Resume" });
    expect(resume).toBeEnabled();
    await userEvent.click(resume);

    expect(runner.props.length).toBeGreaterThan(0);
    expect(runner.props.at(-1)!.status).toBe(status);
  });

  it("hands an open popup the new status", async () => {
    const view = renderCard("trading");
    await userEvent.click(await screen.findByRole("button", { name: "Predict 2 estimates" }));
    expect(runner.props.at(-1)!.status).toBe("trading");

    view.rerenderAt(status);

    expect(runner.props.at(-1)!.status).toBe(status);
  });
});
