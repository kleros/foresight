import { Profiler, type ReactNode } from "react";

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ctx, snapshot, WAD } from "@/features/predict/flow/__tests__/support/fakes";
import { predictFlowId } from "@/features/predict/run/interrupted";
import { useEstimateStore } from "@/features/predict/stores/estimateStore";
import type { SessionDetail } from "@/features/sessions/types";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";
import { toSessionDetail } from "@/features/sessions/utils/toSessionDetail";

import { createRunStore } from "@/lib/flowRunStore";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { addresses, GATEWAY } from "@/testing/fixtures";

import { PredictCard } from "../PredictCard";

const OWNER = "0xa11ce000000000000000000000000000000a11ce";
const HASH = `0x${"ab".repeat(32)}` as const;
const RESUME_OR_DISCARD = "Resume or discard the one below.";
const RESUME_FIRST = "Resume the one below first.";

vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: OWNER }),
}));
vi.mock("@/components/wallet/EnsureChain", () => ({ default: ({ children }: { children: ReactNode }) => children }));
/* stands in for the popup: what it was opened with, and a way to close it */
vi.mock("../PredictRunner", () => ({
  PredictRunner: ({ selected, onClose }: { selected: unknown[]; onClose: () => void }) => (
    <div role="dialog">
      {`${selected.length} to resume`}
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

const session = () =>
  toSessionDetail(
    {
      ...sessionDetailColumns,
      id: "7",
      children: [
        sessionChildRow({ id: addresses.childMarkets[0], parentOutcomeIndex: "0" }),
        sessionChildRow({ id: addresses.childMarkets[1], parentOutcomeIndex: "1" }),
      ],
    },
    GATEWAY,
  );

/** Every option priced one above its lower bound and estimated one above that, so Predict would be on. */
function moveEveryEstimate(detail: SessionDetail) {
  for (const option of detail.options) {
    useEstimateStore.getState().setEstimate(detail.parentMarket, option.market, option.lowerBound + 2);
  }
  return Object.fromEntries(detail.options.map((option) => [option.market.toLowerCase(), option.lowerBound + 1]));
}

function saveRun(deposit: "pending" | "submitted" = "pending") {
  createRunStore().save({
    flowId: predictFlowId("7", OWNER),
    adapterId: "predict-flow",
    snapshot: snapshot({ deposit: WAD * 3n }),
    ctx: ctx({ owner: OWNER, chainId: DEFAULT_CHAIN_ID }),
    steps: [
      {
        stepId: "deposit",
        label: "Add funds",
        outcome: deposit === "submitted" ? { status: "submitted", hash: HASH } : { status: "pending" },
      },
      { stepId: "predict", label: "Predict", outcome: { status: "pending" } },
    ],
    status: "paused",
    reason: "error",
    error: { stepId: "deposit", message: "RPC unavailable", cause: "rpc", hash: HASH },
  });
}

function card(barSlot?: HTMLElement) {
  const detail = session();
  const marketEstimates = moveEveryEstimate(detail);
  return <PredictCard session={detail} status="trading" marketEstimates={marketEstimates} barSlot={barSlot} />;
}

function renderCard(barSlot?: HTMLElement) {
  render(card(barSlot));
  return () => screen.getByRole("button", { name: "Predict 2 estimates" });
}

/** Renders the card, logging after every commit whether its Predict was held or live. */
function renderCounted() {
  const commits: string[] = [];
  render(
    <Profiler
      id="card"
      onRender={() => {
        const predict = screen.queryByRole("button", { name: "Predict 2 estimates" });
        if (predict) commits.push((predict as HTMLButtonElement).disabled ? "held" : "live");
      }}
    >
      {card()}
    </Profiler>,
  );
  return commits;
}

beforeEach(() => {
  window.localStorage.clear();
  useEstimateStore.getState().resetEstimates(session().parentMarket);
});

describe("the predict card with an unfinished run stored", () => {
  it("holds Predict and says to resume or discard the run first", async () => {
    saveRun();
    const predict = renderCard();

    expect(await screen.findByText(RESUME_OR_DISCARD)).toBeVisible();
    expect(predict()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Resume" })).toBeEnabled();
  });

  it("draws no phone bar while the run is stored", async () => {
    saveRun();
    const slot = document.body.appendChild(document.createElement("div"));
    renderCard(slot);

    await screen.findByText(RESUME_OR_DISCARD);
    expect(slot.querySelector("[data-predict-bar]")).toBeNull();
    slot.remove();
  });

  it("lets Predict go once the run is discarded", async () => {
    saveRun();
    const predict = renderCard();

    await userEvent.click(await screen.findByRole("button", { name: "Discard" }));

    await waitFor(() => expect(predict()).toBeEnabled());
    expect(screen.queryByText(RESUME_OR_DISCARD)).toBeNull();
  });

  it("still opens the run from Resume", async () => {
    saveRun();
    renderCard();

    await userEvent.click(await screen.findByRole("button", { name: "Resume" }));

    expect(await screen.findByRole("dialog")).toHaveTextContent("2 to resume");
  });

  it("asks only for Resume while the run's transaction awaits its receipt", async () => {
    saveRun("submitted");
    const predict = renderCard();

    expect(await screen.findByText(RESUME_FIRST)).toBeVisible();
    expect(predict()).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Discard" })).toBeNull();
  });
});

describe("the predict card before it has read the stored run", () => {
  it("holds Predict from its first commit, and names the run only once it is read", async () => {
    saveRun();
    const commits = renderCounted();

    await screen.findByRole("button", { name: "Resume" });
    expect(commits[0]).toBe("held");
    expect(commits).not.toContain("live");
  });

  it("never commits a live Predict when the popup closes over a stored run", async () => {
    saveRun();
    const commits = renderCounted();
    await userEvent.click(await screen.findByRole("button", { name: "Resume" }));
    await screen.findByRole("dialog");

    commits.length = 0;
    await userEvent.click(screen.getByRole("button", { name: "Close" }));

    await screen.findByRole("button", { name: "Resume" });
    expect(commits).not.toContain("live");
  });
});

describe("the predict card when another tab changes the stored run", () => {
  it("holds Predict once another tab stores a run, and lets it go once that tab clears it", async () => {
    const predict = renderCard();
    await waitFor(() => expect(predict()).toBeEnabled());

    saveRun();
    const key = Object.keys(window.localStorage).find((name) => name.endsWith(predictFlowId("7", OWNER)));
    expect(key).toBeDefined();
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: key! }));
    });
    expect(predict()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Resume" })).toBeEnabled();

    window.localStorage.clear();
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });
    expect(predict()).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
  });
});

describe("the predict card with no run stored", () => {
  it("leaves Predict on and says nothing of a run", async () => {
    const predict = renderCard();

    await waitFor(() => expect(predict()).toBeEnabled());
    expect(screen.queryByText(RESUME_OR_DISCARD)).toBeNull();
    expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
  });
});
