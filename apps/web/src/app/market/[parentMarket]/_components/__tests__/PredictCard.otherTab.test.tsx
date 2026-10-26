import { type ReactNode, useEffect } from "react";

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

import { ctx, snapshot, WAD } from "@/features/predict/flow/__tests__/support/fakes";
import { predictFlowId } from "@/features/predict/run/interrupted";
import { PROMPT_OPEN, RUNNING_ELSEWHERE } from "@/features/predict/utils/predictSteps";
import { sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";
import { toSessionDetail } from "@/features/sessions/utils/toSessionDetail";

import { createRunStore } from "@/lib/flowRunStore";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { GATEWAY } from "@/testing/fixtures";

import { PredictCard } from "../PredictCard";

const OWNER = "0xa11ce000000000000000000000000000000a11ce";
const FLOW_ID = predictFlowId("7", OWNER);

/** Whether another tab answers that it holds the run, and whether this tab holds it. */
const other = vi.hoisted(() => ({ holds: true, here: false }));

vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: OWNER }),
}));
vi.mock("@/components/wallet/EnsureChain", () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/features/predict/run/ownership", () => ({
  tabOwnership: () => ({
    claim: () => Promise.resolve(null),
    heldElsewhere: () => Promise.resolve(other.holds),
    heldHere: () => other.here,
  }),
}));

/* stands in for the popup: its driver holds the run from mount until it is disposed on unmount */
vi.mock("../PredictRunner", () => ({
  PredictRunner: ({ onClose }: { onClose: () => void }) => {
    useEffect(() => {
      other.here = true;
      return () => {
        other.here = false;
      };
    }, []);
    return (
      <div role="dialog">
        <button onClick={onClose}>Close</button>
      </div>
    );
  },
}));

const session = () => toSessionDetail({ ...sessionDetailColumns, id: "7", children: [] }, GATEWAY);

/** What tab A leaves in shared storage while its wallet prompt for the deposit is open. */
function plantLiveRun() {
  createRunStore().save({
    flowId: FLOW_ID,
    adapterId: "predict-flow",
    snapshot: snapshot({ deposit: WAD * 3n }),
    ctx: ctx({ owner: OWNER, chainId: DEFAULT_CHAIN_ID }),
    steps: [
      { stepId: "create-wallet", label: "Set up", outcome: { status: "skipped" } },
      { stepId: "deposit", label: "Add funds", outcome: { status: "awaiting-signature" } },
      { stepId: "predict-1", label: "Predict", outcome: { status: "pending" } },
    ],
    status: "running",
  });
}

beforeEach(() => {
  window.localStorage.clear();
  other.holds = true;
  other.here = false;
});

it("shows a run another tab is driving as running there, with Resume and Discard held", async () => {
  plantLiveRun();
  render(<PredictCard session={session()} status="trading" marketEstimates={{}} />);

  expect(await screen.findByText(RUNNING_ELSEWHERE, { exact: false })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Discard" })).toBeNull();
  expect(screen.getByRole("button", { name: "Resume" })).toBeDisabled();
  expect(createRunStore().load(FLOW_ID)).not.toBeNull();
});

it("offers Resume and Discard once the other tab lets the run go", async () => {
  plantLiveRun();
  render(<PredictCard session={session()} status="trading" marketEstimates={{}} />);
  await screen.findByText(RUNNING_ELSEWHERE, { exact: false });

  other.holds = false;
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key: `foresight.tx-flow.${FLOW_ID}` }));
  });

  expect(await screen.findByRole("button", { name: "Discard" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Resume" })).toBeEnabled();
  expect(screen.queryByText(RUNNING_ELSEWHERE, { exact: false })).toBeNull();
});

it("keeps the run when another tab takes it between the card's check and the Discard", async () => {
  plantLiveRun();
  // the check answers that no tab holds it, and the lock is taken by the time Discard asks for it
  other.holds = false;
  render(<PredictCard session={session()} status="trading" marketEstimates={{}} />);

  await userEvent.click(await screen.findByRole("button", { name: "Discard" }));

  expect(createRunStore().load(FLOW_ID)).not.toBeNull();
});

it("says a wallet prompt from this page is still open while this tab holds the run, with Discard held", async () => {
  plantLiveRun();
  other.holds = false;
  other.here = true;
  render(<PredictCard session={session()} status="trading" marketEstimates={{}} />);

  expect(await screen.findByText(PROMPT_OPEN, { exact: false })).toBeInTheDocument();
  expect(screen.queryByText(RUNNING_ELSEWHERE, { exact: false })).toBeNull();
  expect(screen.getByRole("button", { name: "Discard" })).toBeDisabled();
});

it("never says a prompt is open as a popup that held the run closes and lets it go", async () => {
  plantLiveRun();
  other.holds = false;
  const { container } = render(<PredictCard session={session()} status="trading" marketEstimates={{}} />);
  await userEvent.click(await screen.findByRole("button", { name: "Resume" }));
  const shown: string[] = [];
  const observer = new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) shown.push(node.textContent ?? "");
  });
  observer.observe(container, { childList: true, subtree: true, characterData: true });

  await userEvent.click(screen.getByRole("button", { name: "Close" }));
  await screen.findByRole("button", { name: "Discard" });
  observer.disconnect();

  expect(shown.join(" ")).not.toContain(PROMPT_OPEN);
  expect(screen.getByRole("button", { name: "Discard" })).toBeEnabled();
});
