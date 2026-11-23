import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  childMarket,
  OWNER,
  PARENT,
  plannerInput,
  TWO_WINNERS,
} from "@/features/resolution/redeem/__tests__/support/session";
import { planWalletRedeem, type WalletRedeemInput } from "@/features/resolution/redeem/plan";
import type { RedeemProgress } from "@/features/resolution/redeem/run";

import { useWalletRedeem, useWalletRedeemRun } from "../useWalletRedeem";
import { WalletRedeemSection } from "../WalletRedeemSection";

vi.mock("../useWalletRedeem", () => ({ useWalletRedeem: vi.fn(), useWalletRedeemRun: vi.fn() }));

const SESSION = { sessionFactory: "0x5f00000000000000000000000000000000000000" as Address, sessionId: 7n };
const OPTIONS = [
  { market: childMarket(0), outcomeIndex: 0, name: "Denis Villeneuve" },
  { market: childMarket(1), outcomeIndex: 1, name: "Greta Gerwig" },
  { market: childMarket(2), outcomeIndex: 2, name: "Christopher Nolan" },
];

const start = vi.fn();
const resume = vi.fn();
const retry = vi.fn();
const refetch = vi.fn();

function read(state: { input?: WalletRedeemInput; isError?: boolean; isFetching?: boolean }) {
  vi.mocked(useWalletRedeem).mockReturnValue({
    data: state.input && { input: state.input, plan: planWalletRedeem(state.input) },
    isError: state.isError ?? false,
    isFetching: state.isFetching ?? false,
    owner: OWNER,
    refetch,
  } as unknown as ReturnType<typeof useWalletRedeem>);
}

function progress(value: RedeemProgress | null) {
  vi.mocked(useWalletRedeemRun).mockReturnValue({ progress: value, start, resume, retry });
}

const renderSection = () =>
  render(<WalletRedeemSection session={SESSION} parent={TWO_WINNERS.parent} parentMarket={PARENT} options={OPTIONS} />);

beforeEach(() => {
  vi.clearAllMocks();
  progress({ stage: "idle" });
});

describe("the wallet's Redeem section", () => {
  it("lists what the wallet can redeem and signs the shown input on one press", () => {
    const input = plannerInput();
    read({ input });
    renderSection();

    const rows = within(screen.getByRole("list", { name: "What your wallet can redeem" })).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "Winning outcome tokens5.499999999999999998 sDAI",
      "Denis Villeneuve1.999999999641975311 sDAI",
      "Greta Gerwig1.499999999639506172 sDAI",
    ]);
    expect(screen.getByText("8.999999999281481481 sDAI goes to your wallet.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Redeem" }));
    expect(start).toHaveBeenCalledWith(input);
  });

  it("disables Redeem while the run signs or confirms, and while the list is read again", () => {
    for (const [stage, isFetching] of [
      ["signing", false],
      ["confirming", false],
      ["idle", true],
    ] as const) {
      read({ input: plannerInput(), isFetching });
      progress({ stage });
      const { unmount } = renderSection();
      expect(screen.getByRole("button", { name: "Redeem" })).toBeDisabled();
      unmount();
    }
  });

  it("offers to continue a run stored by an earlier visit", () => {
    read({ input: plannerInput() });
    progress({ stage: "review" });
    renderSection();

    fireEvent.click(screen.getByRole("button", { name: "Continue redeem" }));
    expect(resume).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Redeem" })).toBeNull();
  });

  it("offers a retry after a rejected signature, and a new Redeem after a stop that cannot retry", () => {
    read({ input: plannerInput() });
    progress({ stage: "halted", failure: { reason: "rejected", retryable: true } });
    const { unmount } = renderSection();
    expect(screen.getByRole("status")).toHaveTextContent("You rejected the request in your wallet.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
    unmount();

    progress({ stage: "halted", failure: { reason: "changed", retryable: false } });
    renderSection();
    expect(screen.getByRole("status")).toHaveTextContent("What your wallet holds changed");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Redeem" }));
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("keeps a stopped run's section while the list shows nothing left", () => {
    read({ input: plannerInput({ parentBalances: [], childBalances: [] }) });
    progress({ stage: "halted", failure: { reason: "held", retryable: true } });
    renderSection();

    expect(screen.getByRole("heading", { name: "Redeem from your wallet" })).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("says the read failed and offers to read again", () => {
    read({ isError: true });
    renderSection();

    fireEvent.click(screen.getByRole("button", { name: "Read again" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("shows nothing when nothing redeems or waits, or before a read", () => {
    for (const input of [plannerInput({ parentBalances: [], childBalances: [] }), undefined]) {
      read({ input });
      const { container, unmount } = renderSection();
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });
});
