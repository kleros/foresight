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

const runner = vi.hoisted(() => ({ props: [] as Array<Record<string, unknown>> }));
vi.mock("next/dynamic", () => ({
  default: () => (props: Record<string, unknown>) => {
    if ("selected" in props) runner.props.push(props);
    return null;
  },
}));
vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: OWNER, chainId: 100 }),
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

const RESOLVED = "This session has resolved.";
const UNKNOWN = "Couldn't check whether this session has resolved. Trying again.";

function renderCard(status: SessionStatus, recheckStatus?: () => Promise<SessionStatus>) {
  detail.options.forEach((option, index) =>
    useEstimateStore.getState().setEstimate(detail.parentMarket, option.market, [400, 120][index]!),
  );
  return render(
    <PredictCard
      session={detail}
      status={status}
      marketEstimates={marketEstimates}
      hasLiquidity
      recheckStatus={recheckStatus}
    />,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  runner.props.length = 0;
  stored.run = null;
  stored.pending = false;
  useEstimateStore.getState().resetEstimates(detail.parentMarket);
  document.body.replaceChildren();
});

describe("the predict card names the status it is blocked by", () => {
  it("says the session has resolved, not that its status is unknown", async () => {
    renderCard("resolved");

    expect(await screen.findByText(RESOLVED)).toBeInTheDocument();
    expect(screen.queryByText(UNKNOWN)).toBeNull();
  });

  it("says the status could not be checked, not that the session has resolved", async () => {
    renderCard("unknown");

    expect(await screen.findByText(UNKNOWN)).toBeInTheDocument();
    expect(screen.queryByText(RESOLVED)).toBeNull();
  });
});

describe.each(["resolved", "unknown"] as const)("a stored run under status %s", (status) => {
  it("opens with no transaction in flight, so what it sent can be inspected", async () => {
    stored.run = { deposit: 0n, creditsToSpend: 0n };
    stored.pending = false;
    renderCard(status);

    const resume = await screen.findByRole("button", { name: "Resume" });
    expect(resume).toBeEnabled();
    await userEvent.click(resume);

    expect(runner.props.at(-1)?.status).toBe(status);
  });
});

describe("the predict card hands the popup the status re-read", () => {
  it("passes it on Predict", async () => {
    const recheckStatus = vi.fn(() => Promise.resolve<SessionStatus>("trading"));
    renderCard("trading", recheckStatus);

    await userEvent.click(await screen.findByRole("button", { name: "Predict 2 estimates" }));

    expect(runner.props.at(-1)?.recheckStatus).toBe(recheckStatus);
  });

  it("passes it on Resume", async () => {
    stored.run = { deposit: 0n, creditsToSpend: 0n };
    const recheckStatus = vi.fn(() => Promise.resolve<SessionStatus>("trading"));
    renderCard("trading", recheckStatus);

    await userEvent.click(await screen.findByRole("button", { name: "Resume" }));

    expect(runner.props.at(-1)?.recheckStatus).toBe(recheckStatus);
  });
});
