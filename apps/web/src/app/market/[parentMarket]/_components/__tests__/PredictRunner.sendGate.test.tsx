import type { ComponentProps, ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Address, Hash } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAccount } from "wagmi";

import type { PredictDialog } from "@/features/predict/components/PredictDialog";
import { snapshot } from "@/features/predict/flow/__tests__/support/fakes";
import { usePredictRun, type PredictRunInput } from "@/features/predict/hooks/usePredictRun";
import type { PredictDriver, PredictProgress, PredictStage } from "@/features/predict/run/types";
import type { SessionStatus } from "@/features/sessions/types";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";
import { toSessionDetail } from "@/features/sessions/utils/toSessionDetail";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { GATEWAY } from "@/testing/fixtures";

import { PredictRunner } from "../PredictRunner";
import { STATUS_REASON } from "../statusReason";
import { usePredictFunding } from "../usePredictFunding";

const OWNER = "0x9999999999999999999999999999999999999999" as Address;
const EXECUTOR = "0x8888888888888888888888888888888888888888" as Address;
const HASH = `0x${"ab".repeat(32)}` as Hash;

vi.mock("@/lib/graphql/batcher", () => ({ fetchGraphql: vi.fn() }));
vi.mock("@/config/ipfs", () => ({ IPFS_GATEWAY: "https://cdn.example.link/ipfs" }));
vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));
vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: vi.fn(),
}));
vi.mock("@/config/contracts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/contracts")>()),
  gnosisRouterAddress: () => "0x7777777777777777777777777777777777777777",
  tradeExecutorFactoryAddress: () => "0x6666666666666666666666666666666666666666",
}));
vi.mock("@/features/predict/hooks/usePredictRun", () => ({ usePredictRun: vi.fn() }));
vi.mock("@/features/trade-executor/api/getExecutor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/trade-executor/api/getExecutor")>()),
  useExecutor: () => ({ data: { predicted: EXECUTOR, deployed: true } }),
}));
vi.mock("../usePredictFunding", () => ({ usePredictFunding: vi.fn() }));
vi.mock("../useHasPredicted", () => ({ useHasPredicted: () => false }));
vi.mock("../useCreditsSwapPreview", () => ({ useCreditsSwapPreview: () => ({ failed: false }) }));

type DialogProps = ComponentProps<typeof PredictDialog>;
vi.mock("@/features/predict/components/PredictDialog", () => ({
  PredictDialog: (props: DialogProps) => (
    <div>
      <p data-testid="notice">{props.notice ?? ""}</p>
      <p data-testid="check-only">{String(Boolean(props.isCheckOnly))}</p>
      <button onClick={props.onPredict}>predict</button>
    </div>
  ),
}));

const runMock = vi.mocked(usePredictRun);

const progressAt = (stage: PredictStage, extra: Partial<PredictProgress> = {}): PredictProgress => ({
  stage,
  steps: [],
  leftOut: [],
  batchesDone: 0,
  batches: 0,
  ...extra,
});
const halted = (reason: NonNullable<PredictProgress["failure"]>["reason"], extra: Partial<PredictProgress> = {}) =>
  progressAt("halted", { failure: { reason, retryable: true }, ...extra });

const driver = {
  start: vi.fn<PredictDriver["start"]>(),
  recover: vi.fn<PredictDriver["recover"]>(),
  resume: vi.fn<PredictDriver["resume"]>(),
  confirm: vi.fn<PredictDriver["confirm"]>(),
  retry: vi.fn<PredictDriver["retry"]>(),
  discard: vi.fn<PredictDriver["discard"]>(),
  reset: vi.fn<PredictDriver["reset"]>(),
  dispose: vi.fn<PredictDriver["dispose"]>(),
  subscribe: vi.fn<PredictDriver["subscribe"]>(() => () => {}),
  getProgress: vi.fn<PredictDriver["getProgress"]>(() => progressAt("idle")),
} satisfies PredictDriver;

let progress: PredictProgress | null = null;

const detail = toSessionDetail({ ...sessionDetailColumns, children: [sessionChildRow()] }, GATEWAY);

function mount(status: SessionStatus, recheckStatus?: () => Promise<SessionStatus>) {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const ui = (at: SessionStatus) => (
    <PredictRunner
      session={detail}
      status={at}
      recheckStatus={recheckStatus}
      selected={[{ scale: detail.options[0]!, value: 312, marketEstimate: 250, direction: "higher" }]}
      onClose={vi.fn()}
      onSuccess={vi.fn()}
    />
  );
  const view = render(ui(status), { wrapper });
  return { ...view, rerenderAt: (at: SessionStatus) => view.rerender(ui(at)) };
}

/** The send gate the runner last handed the run. */
const gate = (): (() => Promise<boolean>) => {
  const inputs = runMock.mock.calls.map(([given]) => given).filter((given): given is PredictRunInput => given !== null);
  return inputs.at(-1)!.maySend!;
};

/** Asks the gate as the run would, right before a wallet send. */
const maySend = () => gate()();

beforeEach(() => {
  vi.clearAllMocks();
  progress = null;
  vi.mocked(useAccount).mockReturnValue({ address: OWNER, chainId: DEFAULT_CHAIN_ID } as ReturnType<typeof useAccount>);
  vi.mocked(usePredictFunding).mockImplementation(() => ({
    funding: null,
    credits: { state: "none" },
    token: undefined,
    available: () => undefined,
    canPayNative: true,
  }));
  runMock.mockImplementation(() => ({ driver, progress }));
});

describe("PredictRunner's notice for each status that stops sends", () => {
  it.each(["resolved", "unknown"] as const)("says exactly why under %s", (status) => {
    mount(status);
    expect(screen.getByTestId("notice").textContent).toBe(STATUS_REASON[status]);
  });
});

describe.each(["resolved", "unknown"] as const)(
  "PredictRunner under status %s, with a transaction outstanding",
  (status) => {
    it.each([
      [
        "a stopped run whose sent hash has no receipt yet",
        halted("pending", { pendingHash: HASH, moneyMoved: true }),
        "retry",
      ],
      [
        "a held send past its hold, which would otherwise be signed again",
        halted("resign", { unanswered: true, moneyMoved: true }),
        "retry",
      ],
      [
        "a stored run's deposit that may have been signed with no hash kept",
        halted("deposit-unconfirmed", { recovered: snapshot() }),
        "retry",
      ],
      [
        "a stored run under review with a sent hash",
        progressAt("review", { pendingHash: HASH, recovered: snapshot() }),
        "resume",
      ],
      [
        "a stored run under review with a held send",
        progressAt("review", { unanswered: true, recovered: snapshot() }),
        "resume",
      ],
      ["a stopped run waiting on a transaction from the wallet", halted("pending", { moneyMoved: true }), "retry"],
    ] satisfies Array<[string, PredictProgress, "retry" | "resume"]>)(
      "reads it from the chain on the press: %s",
      (_name, at, action) => {
        progress = at;
        mount(status);
        expect(screen.getByTestId("check-only")).toHaveTextContent("true");

        fireEvent.click(screen.getByText("predict"));

        expect(driver[action]).toHaveBeenCalledTimes(1);
        expect(driver[action]).toHaveBeenCalledWith(undefined);
        expect(driver.start).not.toHaveBeenCalled();
        expect(driver.confirm).not.toHaveBeenCalled();
      },
    );

    it("holds a check on a stored run that spends credits to the same credits review as a signing press", () => {
      progress = progressAt("review", { pendingHash: HASH, recovered: snapshot({ creditsToSpend: 10n ** 18n }) });
      mount(status);

      fireEvent.click(screen.getByText("predict"));

      // no credits price is quoted here, so the run stops at moved before it signs the swap
      expect(driver.resume).toHaveBeenCalledWith({});
    });

    it("offers no check where nothing is outstanding", () => {
      progress = halted("refused", { moneyMoved: true });
      mount(status);

      expect(screen.getByTestId("check-only")).toHaveTextContent("false");
      fireEvent.click(screen.getByText("predict"));
      expect(driver.retry).not.toHaveBeenCalled();
    });
  },
);

describe("PredictRunner's send gate", () => {
  it("lets a send through while trading with no recheck", async () => {
    mount("trading");
    await expect(maySend()).resolves.toBe(true);
  });

  it.each(["resolved", "unknown"] as const)("refuses a send under %s without asking the recheck", async (status) => {
    const recheck = vi.fn(async (): Promise<SessionStatus> => "trading");
    mount(status, recheck);

    await expect(maySend()).resolves.toBe(false);
    expect(recheck).not.toHaveBeenCalled();
  });

  it("refuses a send the page's status stopped after the run was handed its gate", async () => {
    const view = mount("trading");
    const gateAtStart = gate();

    view.rerenderAt("unknown");

    await expect(gateAtStart()).resolves.toBe(false);
  });

  it.each([
    ["the fresh read says resolved", async (): Promise<SessionStatus> => "resolved", false],
    ["the fresh read says unknown", async (): Promise<SessionStatus> => "unknown", false],
    [
      "the fresh read fails",
      async (): Promise<SessionStatus> => Promise.reject(new Error("HTTP request failed")),
      false,
    ],
    ["the fresh read says trading", async (): Promise<SessionStatus> => "trading", true],
  ])("asks the recheck before each send: %s", async (_name, recheck, allowed) => {
    const spy = vi.fn(recheck);
    mount("trading", spy);

    await expect(maySend()).resolves.toBe(allowed);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("refuses when the page's status stops sends while the recheck is out", async () => {
    let answer: (status: SessionStatus) => void = () => {};
    const view = mount("trading", () => new Promise<SessionStatus>((resolve) => (answer = resolve)));

    const asked = maySend();
    view.rerenderAt("resolved");
    await act(async () => answer("trading"));

    await expect(asked).resolves.toBe(false);
  });
});
