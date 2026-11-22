import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionStatus } from "@/features/sessions/types";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";
import { toSessionDetail } from "@/features/sessions/utils/toSessionDetail";

import { GATEWAY } from "@/testing/fixtures";

import { PredictRunner } from "../PredictRunner";
import { usePredictExecution } from "../usePredictExecution";

/** The gate the popup hands its run: the page's status as rendered, and as read again just before a send. */

vi.mock("@/lib/graphql/batcher", () => ({ fetchGraphql: vi.fn() }));
vi.mock("@/config/ipfs", () => ({ IPFS_GATEWAY: "https://cdn.example.link/ipfs" }));
vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));
vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: "0x9999999999999999999999999999999999999999", chainId: 100 }),
}));
vi.mock("@/features/trade-executor/api/getExecutor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/trade-executor/api/getExecutor")>()),
  useExecutor: () => ({ data: { predicted: "0x8888888888888888888888888888888888888888", deployed: true } }),
}));
vi.mock("../usePredictFunding", () => ({
  usePredictFunding: () => ({ funding: null, credits: { state: "none" }, available: () => undefined }),
}));
vi.mock("../useHasPredicted", () => ({ useHasPredicted: () => false }));
vi.mock("../useCreditsSwapPreview", () => ({ useCreditsSwapPreview: () => ({ failed: false }) }));
vi.mock("../usePredictExecution", () => ({ usePredictExecution: vi.fn() }));
vi.mock("@/features/predict/components/PredictDialog", () => ({ PredictDialog: () => null }));

const executionMock = vi.mocked(usePredictExecution);

const session = toSessionDetail({ ...sessionDetailColumns, children: [sessionChildRow()] }, GATEWAY);

function mount(status: SessionStatus, recheckStatus?: () => Promise<SessionStatus>) {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const ui = (at: SessionStatus) => (
    <PredictRunner
      session={session}
      status={at}
      recheckStatus={recheckStatus}
      selected={[]}
      onClose={vi.fn()}
      onSuccess={vi.fn()}
    />
  );
  const view = render(ui(status), { wrapper });
  return { rerenderAt: (at: SessionStatus) => view.rerender(ui(at)) };
}

const maySend = () => executionMock.mock.calls.at(-1)![0].maySend!();

beforeEach(() => {
  executionMock.mockReset();
  executionMock.mockReturnValue({ driver: null, progress: null, ready: true });
});

describe("PredictRunner's send gate", () => {
  it("lets a trading session send when the fresh read agrees", async () => {
    const recheck = vi.fn(() => Promise.resolve<SessionStatus>("trading"));
    mount("trading", recheck);

    await expect(maySend()).resolves.toBe(true);
    expect(recheck).toHaveBeenCalledTimes(1);
  });

  it("reads the status again before every send", async () => {
    const recheck = vi.fn(() => Promise.resolve<SessionStatus>("trading"));
    mount("trading", recheck);

    await maySend();
    await maySend();

    expect(recheck).toHaveBeenCalledTimes(2);
  });

  it.each(["resolved", "unknown"] as const)(
    "refuses when the fresh read says %s though the page shows trading",
    async (fresh) => {
      mount("trading", () => Promise.resolve(fresh));

      await expect(maySend()).resolves.toBe(false);
    },
  );

  it.each(["resolved", "unknown"] as const)("refuses under %s without reading again", async (status) => {
    const recheck = vi.fn(() => Promise.resolve<SessionStatus>("trading"));
    mount(status, recheck);

    await expect(maySend()).resolves.toBe(false);
    expect(recheck).not.toHaveBeenCalled();
  });

  it("refuses when the page's status changes while the fresh read is out", async () => {
    let answer: (status: SessionStatus) => void = () => {};
    const view = mount("trading", () => new Promise((resolve) => (answer = resolve)));

    const asked = maySend();
    view.rerenderAt("resolved");
    answer("trading");

    await expect(asked).resolves.toBe(false);
  });
});
