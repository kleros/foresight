import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  childMarket,
  OWNER,
  PARENT,
  plannerInput,
  TWO_WINNERS,
  unresolvedChild,
  valuedChild,
} from "@/features/resolution/redeem/__tests__/support/session";
import { planWalletRedeem } from "@/features/resolution/redeem/plan";
import type { RedeemProgress } from "@/features/resolution/redeem/run";

import { useWalletRedeem, useWalletRedeemRun, type WalletRedeemRead } from "../useWalletRedeem";
import { START_OVER_WARNING, WalletRedeemSection } from "../WalletRedeemSection";

vi.mock("../useWalletRedeem", () => ({ useWalletRedeem: vi.fn(), useWalletRedeemRun: vi.fn() }));

const SESSION = { sessionFactory: "0x5f00000000000000000000000000000000000000" as Address, sessionId: 7n };
const OPTIONS = [
  { market: childMarket(0), outcomeIndex: 0, name: "Denis Villeneuve" },
  { market: childMarket(1), outcomeIndex: 1, name: "Greta Gerwig" },
  { market: childMarket(2), outcomeIndex: 2, name: "Christopher Nolan" },
];

const refetch = vi.fn();
const handle = {
  start: vi.fn(),
  resume: vi.fn(),
  retry: vi.fn(),
  reset: vi.fn(),
  discard: vi.fn(),
};

function read(overrides: Parameters<typeof plannerInput>[0] = {}): WalletRedeemRead {
  const input = plannerInput(overrides);
  return { input, plan: planWalletRedeem(input) };
}

function list(state: { data?: WalletRedeemRead; isError?: boolean; isFetching?: boolean; owner?: Address }) {
  vi.mocked(useWalletRedeem).mockReturnValue({
    data: state.data,
    isError: state.isError ?? false,
    isFetching: state.isFetching ?? false,
    owner: "owner" in state ? state.owner : OWNER,
    refetch,
  } as unknown as ReturnType<typeof useWalletRedeem>);
}

function running(progress: RedeemProgress | null) {
  vi.mocked(useWalletRedeemRun).mockReturnValue({
    progress,
    ...handle,
    isRunning: progress?.stage === "signing" || progress?.stage === "confirming",
  });
}

const renderSection = () =>
  render(<WalletRedeemSection session={SESSION} parent={TWO_WINNERS.parent} parentMarket={PARENT} options={OPTIONS} />);

const section = () => screen.getByRole("region", { name: "Redeem from your wallet" });

beforeEach(() => {
  vi.clearAllMocks();
  list({ data: read() });
  running({ stage: "idle" });
});

describe("WalletRedeemSection", () => {
  it("lists each part's payout and Redeem signs what it showed", () => {
    const shown = read();
    list({ data: shown });
    renderSection();

    const rows = within(section()).getByRole("list", { name: "What your wallet can redeem" });
    expect(within(rows).getByText("Winning outcome tokens")).toBeInTheDocument();
    expect(within(rows).getByText("Denis Villeneuve")).toBeInTheDocument();
    fireEvent.click(within(section()).getByRole("button", { name: "Redeem" }));

    expect(handle.start).toHaveBeenCalledWith(shown.input);
  });

  it("shows an option that waits for its result, with no Redeem when nothing else pays", () => {
    list({
      data: read({
        resolution: { parent: TWO_WINNERS.parent, children: { 0: unresolvedChild(0), 1: unresolvedChild(1) } },
        parentBalances: [0n, 0n, 0n, 0n],
      }),
    });
    renderSection();

    expect(within(section()).getAllByText("Waiting for result")).toHaveLength(2);
    expect(within(section()).queryByRole("button", { name: "Redeem" })).toBeNull();
  });

  it("is hidden while the wallet holds nothing to redeem or wait for", () => {
    list({ data: read({ parentBalances: [0n, 0n, 0n, 0n], childBalances: [] }) });
    renderSection();

    expect(screen.queryByRole("region", { name: "Redeem from your wallet" })).toBeNull();
  });

  it("is hidden before the parent resolved and with no account on the redeem chain", () => {
    const { rerender } = render(
      <WalletRedeemSection session={SESSION} parent={{ resolved: false }} parentMarket={PARENT} options={OPTIONS} />,
    );
    expect(screen.queryByRole("region")).toBeNull();

    list({ data: read(), owner: undefined });
    rerender(
      <WalletRedeemSection session={SESSION} parent={TWO_WINNERS.parent} parentMarket={PARENT} options={OPTIONS} />,
    );
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("offers to read the list again when the read failed", () => {
    list({ isError: true });
    renderSection();

    fireEvent.click(within(section()).getByRole("button", { name: "Read again" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("says what the run is doing in place of Redeem while it signs", () => {
    running({ stage: "signing" });
    renderSection();

    expect(within(section()).getByRole("status")).toHaveTextContent("Confirm the redeem in your wallet.");
    expect(within(section()).queryByRole("button", { name: "Redeem" })).toBeNull();
  });

  it("carries a stored run on from review", () => {
    running({ stage: "review" });
    renderSection();

    fireEvent.click(within(section()).getByRole("button", { name: "Continue redeem" }));
    expect(handle.resume).toHaveBeenCalled();
  });

  it("shows a stopped run even once the list is empty", () => {
    list({ data: read({ parentBalances: [0n, 0n, 0n, 0n], childBalances: [] }) });
    running({ stage: "halted", failure: { reason: "rejected", retryable: true } });
    renderSection();

    expect(within(section()).getByRole("status")).toHaveTextContent("You declined the request in your wallet.");
    fireEvent.click(within(section()).getByRole("button", { name: "Try again" }));
    expect(handle.retry).toHaveBeenCalled();
  });

  it("starts over at once a stopped run that holds no send", () => {
    running({ stage: "halted", failure: { reason: "changed", retryable: false } });
    renderSection();

    expect(within(section()).queryByRole("button", { name: "Try again" })).toBeNull();
    fireEvent.click(within(section()).getByRole("button", { name: "Start over" }));
    expect(handle.reset).toHaveBeenCalled();
    expect(handle.discard).not.toHaveBeenCalled();
  });

  it.each([
    ["held", true],
    ["batch-unknown", false],
  ] as const)("asks first, then discards, a run stopped as %s holding a send", (reason, retryable) => {
    running({ stage: "halted", failure: { reason, retryable }, holdsSend: true });
    renderSection();

    fireEvent.click(within(section()).getByRole("button", { name: "Start over" }));
    expect(within(section()).getByRole("alert")).toHaveTextContent(START_OVER_WARNING);
    expect(handle.discard).not.toHaveBeenCalled();

    fireEvent.click(within(section()).getByRole("button", { name: "Start over" }));
    expect(handle.discard).toHaveBeenCalledTimes(1);
    expect(handle.reset).not.toHaveBeenCalled();
  });

  it("goes back without discarding", () => {
    running({ stage: "review", holdsSend: true });
    renderSection();

    fireEvent.click(within(section()).getByRole("button", { name: "Start over" }));
    fireEvent.click(within(section()).getByRole("button", { name: "Back" }));

    expect(handle.discard).not.toHaveBeenCalled();
    expect(within(section()).getByRole("button", { name: "Continue redeem" })).toBeInTheDocument();
  });

  it("pays a resolved winner's child part as the planner does", () => {
    const shown = read({
      resolution: { parent: TWO_WINNERS.parent, children: { 0: valuedChild(0, 40n), 1: unresolvedChild(1) } },
    });
    list({ data: shown });
    renderSection();

    expect(within(section()).getByText(/goes to your wallet\.$/)).toBeInTheDocument();
    expect(shown.plan.waiting).toEqual([1]);
  });
});
