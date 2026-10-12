import type { ReactNode } from "react";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

import { ctx, snapshot, WAD } from "@/features/predict/flow/__tests__/support/fakes";
import { predictFlowId } from "@/features/predict/run/interrupted";
import { sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";
import { toSessionDetail } from "@/features/sessions/utils/toSessionDetail";

import { createRunStore } from "@/lib/flowRunStore";

import { GATEWAY } from "@/testing/fixtures";

import { PredictCard } from "../PredictCard";

const OWNER = "0xa11ce000000000000000000000000000000a11ce";

vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: OWNER }),
}));
vi.mock("@/components/wallet/EnsureChain", () => ({ default: ({ children }: { children: ReactNode }) => children }));

const session = () => toSessionDetail({ ...sessionDetailColumns, id: "7", children: [] }, GATEWAY);

beforeEach(() => {
  window.localStorage.clear();
  createRunStore().save({
    flowId: predictFlowId("7"),
    adapterId: "predict-flow",
    snapshot: snapshot({ deposit: WAD * 3n }),
    ctx: ctx({ owner: OWNER }),
    steps: [{ stepId: "deposit", label: "Add funds", outcome: { status: "pending" } }],
    status: "running",
  });
});

it("forgets the interrupted run when it is discarded", async () => {
  render(<PredictCard session={session()} status="trading" marketEstimates={{}} />);

  await userEvent.click(await screen.findByRole("button", { name: "Discard" }));

  expect(createRunStore().load(predictFlowId("7"))).toBeNull();
  expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
});
