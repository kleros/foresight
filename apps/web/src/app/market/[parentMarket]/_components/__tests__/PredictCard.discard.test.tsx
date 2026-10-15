import type { ReactNode } from "react";

import type { RunPhase, StepOutcome } from "@foresight/tx-orchestrator";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

import { ctx, snapshot, WAD } from "@/features/predict/flow/__tests__/support/fakes";
import { predictFlowId } from "@/features/predict/run/interrupted";
import { sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";
import { toSessionDetail } from "@/features/sessions/utils/toSessionDetail";

import { createRunStore } from "@/lib/flowRunStore";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { GATEWAY } from "@/testing/fixtures";

import { PredictCard } from "../PredictCard";

const OWNER = "0xa11ce000000000000000000000000000000a11ce";

vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: OWNER }),
}));
vi.mock("@/components/wallet/EnsureChain", () => ({ default: ({ children }: { children: ReactNode }) => children }));

const session = () => toSessionDetail({ ...sessionDetailColumns, id: "7", children: [] }, GATEWAY);

const HASH = `0x${"ab".repeat(32)}` as const;

type PersistedPhase = Exclude<RunPhase, { status: "completed" }>;

const halted: PersistedPhase = {
  status: "paused",
  reason: "error",
  error: { stepId: "deposit", message: "RPC unavailable", cause: "rpc", hash: HASH },
};

function saveRun(deposit: StepOutcome, phase: PersistedPhase, flowId = predictFlowId("7", OWNER), amount = WAD * 3n) {
  createRunStore().save({
    flowId,
    adapterId: "predict-flow",
    snapshot: snapshot({ deposit: amount }),
    ctx: ctx({ owner: OWNER, chainId: DEFAULT_CHAIN_ID }),
    steps: [
      { stepId: "deposit", label: "Add funds", outcome: deposit },
      { stepId: "predict", label: "Predict", outcome: { status: "pending" } },
    ],
    ...phase,
  });
}

beforeEach(() => {
  window.localStorage.clear();
});

it.each([
  ["nothing was submitted", { status: "pending" }, { status: "running" }],
  ["the deposit confirmed", { status: "confirmed", hash: HASH, blockNumber: 1n }, { status: "running" }],
  [
    "the deposit reverted",
    { status: "pending" },
    {
      status: "failed",
      error: { stepId: "deposit", message: "The transaction reverted on chain.", cause: "reverted", hash: HASH },
    },
  ],
] as const)("forgets the interrupted run when it is discarded after %s", async (_name, deposit, phase) => {
  saveRun(deposit, phase);
  render(<PredictCard session={session()} status="trading" marketEstimates={{}} />);

  await userEvent.click(await screen.findByRole("button", { name: "Discard" }));

  expect(createRunStore().load(predictFlowId("7", OWNER))).toBeNull();
  expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
});

it("offers Resume but not Discard while the run's transaction awaits its receipt", async () => {
  saveRun(
    { status: "submitted", hash: HASH },
    {
      status: "paused",
      reason: "error",
      error: { stepId: "deposit", message: "RPC unavailable", cause: "rpc", hash: HASH },
    },
  );
  render(<PredictCard session={session()} status="trading" marketEstimates={{}} />);

  expect(await screen.findByRole("button", { name: "Resume" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Discard" })).toBeNull();
  expect(createRunStore().load(predictFlowId("7", OWNER))).not.toBeNull();
});

it("says a transaction may still be pending while the run's transaction awaits its receipt", async () => {
  saveRun({ status: "submitted", hash: HASH }, halted);
  render(<PredictCard session={session()} status="trading" marketEstimates={{}} />);

  expect(
    await screen.findByText(
      "A prediction with a 3 sDAI deposit did not finish. A transaction from it may still be pending.",
    ),
  ).toBeInTheDocument();
});

it("shows the interrupted deposit at four decimals, not every wei", async () => {
  saveRun({ status: "pending" }, { status: "running" }, undefined, 4_123456789012345678n);
  render(<PredictCard session={session()} status="trading" marketEstimates={{}} />);

  expect(await screen.findByText("A prediction with a 4.1235 sDAI deposit did not finish.")).toBeInTheDocument();
});
