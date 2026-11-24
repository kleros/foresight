import { fireEvent, render, screen, within } from "@testing-library/react";
import { isAddressEqual, type Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  childMarket,
  PARENT,
  plannerInput,
  TWO_WINNERS,
  unresolvedChild,
  valuedChild,
} from "@/features/resolution/redeem/__tests__/support/session";
import { planWalletRedeem } from "@/features/resolution/redeem/plan";

import { formatDisplayAmount } from "@/utils/amount";

import { useWalletRedeem, useWalletRedeemRun, type WalletRedeemRead } from "../useWalletRedeem";
import { WalletRedeemSection } from "../WalletRedeemSection";

vi.mock("../useWalletRedeem", () => ({ useWalletRedeem: vi.fn(), useWalletRedeemRun: vi.fn() }));

const SESSION = { sessionFactory: "0x5f00000000000000000000000000000000000000" as Address, sessionId: 7n };
const OWNER = "0x0000000000000000000000000000000000001a01" as Address;
/** Listed out of outcome order, so an option found by its place in the list is the wrong one. */
const OPTIONS = [
  { market: childMarket(2), outcomeIndex: 2, name: "Christopher Nolan" },
  { market: childMarket(0), outcomeIndex: 0, name: "Denis Villeneuve" },
  { market: childMarket(1), outcomeIndex: 1, name: "Greta Gerwig" },
];
const start = vi.fn();

const sDai = (value: bigint) => `${formatDisplayAmount(value, 18, 18)} sDAI`;

function read(overrides: Parameters<typeof plannerInput>[0] = {}): WalletRedeemRead {
  const input = plannerInput(overrides);
  return { input, plan: planWalletRedeem(input) };
}

function list(data: WalletRedeemRead, isFetching = false) {
  vi.mocked(useWalletRedeem).mockReturnValue({
    data,
    isError: false,
    isFetching,
    owner: OWNER,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useWalletRedeem>);
}

const renderSection = () =>
  render(<WalletRedeemSection session={SESSION} parent={TWO_WINNERS.parent} parentMarket={PARENT} options={OPTIONS} />);

const rows = () => within(screen.getByRole("list", { name: "What your wallet can redeem" })).getAllByRole("listitem");
const rowNamed = (name: string) => rows().find((row) => within(row).queryByText(name) !== null)!;

/** The shown plan has several parts whose payouts differ from each other and from the total. */
function expectDistinctPayouts({ plan }: WalletRedeemRead) {
  const payouts = plan.parts.map((part) => part.payout);
  expect(payouts.length).toBeGreaterThan(1);
  expect(new Set(payouts).size).toBe(payouts.length);
  expect(payouts).not.toContain(plan.payout);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useWalletRedeemRun).mockReturnValue({
    progress: { stage: "idle" },
    start,
    resume: vi.fn(),
    retry: vi.fn(),
    reset: vi.fn(),
    discard: vi.fn(),
    isRunning: false,
  });
});

describe("WalletRedeemSection's amounts", () => {
  it("says the plan's total goes to the wallet", () => {
    const shown = read();
    expectDistinctPayouts(shown);
    list(shown);
    renderSection();

    expect(screen.getByText(/goes to your wallet\.$/)).toHaveTextContent(
      `${sDai(shown.plan.payout)} goes to your wallet.`,
    );
  });

  it("shows each part's own payout on its row", () => {
    const shown = read();
    expectDistinctPayouts(shown);
    list(shown);
    renderSection();

    for (const part of shown.plan.parts) {
      const name = isAddressEqual(part.market, PARENT)
        ? "Winning outcome tokens"
        : OPTIONS.find((option) => isAddressEqual(option.market, part.market))!.name;
      const row = rowNamed(name);
      expect(within(row).getByText(sDai(part.payout))).toBeInTheDocument();
      expect(row).not.toHaveTextContent(sDai(shown.plan.payout));
    }
  });

  it("names the option a waiting row waits for", () => {
    const shown = read({
      resolution: { parent: TWO_WINNERS.parent, children: { 0: valuedChild(0, 42n), 1: unresolvedChild(1) } },
    });
    expect(shown.plan.waiting).toEqual([1]);
    list(shown);
    renderSection();

    const waiting = rows().filter((row) => within(row).queryByText("Waiting for result") !== null);
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toHaveTextContent("Greta Gerwig");
    expect(waiting[0]).not.toHaveTextContent(/Christopher Nolan|Denis Villeneuve/);
  });

  it("holds Redeem while the list is read again", () => {
    list(read(), true);
    renderSection();

    const redeem = screen.getByRole("button", { name: "Redeem" });
    expect(redeem).toBeDisabled();
    fireEvent.click(redeem);
    expect(start).not.toHaveBeenCalled();
  });
});
