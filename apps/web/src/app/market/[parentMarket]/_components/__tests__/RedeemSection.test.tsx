import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  childMarket,
  OWNER,
  PARENT,
  planFor,
  TWO_WINNERS,
  unresolvedChild,
  valuedChild,
} from "@/features/resolution/redeem/__tests__/support/session";
import type { RedeemPlan } from "@/features/resolution/redeem/plan";

import { RedeemSection } from "../RedeemSection";
import { useRedeemFromTradeWallet, useTradeWalletRedeem } from "../useTradeWalletRedeem";

vi.mock("../useTradeWalletRedeem", () => ({ useTradeWalletRedeem: vi.fn(), useRedeemFromTradeWallet: vi.fn() }));

const SESSION = { sessionFactory: "0x5f00000000000000000000000000000000000000" as Address, sessionId: 7n };
const OPTIONS = [
  { market: childMarket(0), outcomeIndex: 0, name: "Denis Villeneuve" },
  { market: childMarket(1), outcomeIndex: 1, name: "Greta Gerwig" },
  { market: childMarket(2), outcomeIndex: 2, name: "Christopher Nolan" },
];

const mutate = vi.fn();
const refetch = vi.fn();

function list(state: { data?: RedeemPlan; isError?: boolean; isFetching?: boolean; owner?: Address }) {
  vi.mocked(useTradeWalletRedeem).mockReturnValue({
    data: state.data,
    isError: state.isError ?? false,
    isFetching: state.isFetching ?? false,
    owner: "owner" in state ? state.owner : OWNER,
    refetch,
  } as unknown as ReturnType<typeof useTradeWalletRedeem>);
}

function run(isPending = false) {
  vi.mocked(useRedeemFromTradeWallet).mockReturnValue({ mutate, isPending } as unknown as ReturnType<
    typeof useRedeemFromTradeWallet
  >);
}

const renderSection = () =>
  render(<RedeemSection session={SESSION} parent={TWO_WINNERS.parent} parentMarket={PARENT} options={OPTIONS} />);

beforeEach(() => {
  mutate.mockClear();
  refetch.mockClear();
  run();
});

describe("the Redeem section", () => {
  it("lists each part's payout to the wei and redeems the shown list for the owner on one press", () => {
    const plan = planFor();
    list({ data: plan });
    renderSection();

    const rows = within(screen.getByRole("list", { name: "What your trade wallet can redeem" })).getAllByRole(
      "listitem",
    );
    expect(rows.map((row) => row.textContent)).toEqual([
      "Winning outcome tokens5.499999999999999998 sDAI",
      "Denis Villeneuve1.999999999641975311 sDAI",
      "Greta Gerwig1.499999999639506172 sDAI",
    ]);
    expect(plan.parts.map((part) => part.payout)).toEqual([
      5_499_999_999_999_999_998n,
      1_999_999_999_641_975_311n,
      1_499_999_999_639_506_172n,
    ]);
    expect(screen.getByText("8.999999999281481481 sDAI goes to your trade wallet.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Redeem" }));
    expect(mutate).toHaveBeenCalledWith({ shown: plan, owner: OWNER, session: SESSION });
  });

  it("lists a held option still waiting for its result, without a button when nothing else redeems", () => {
    const plan = planFor({
      resolution: { ...TWO_WINNERS, children: { 0: valuedChild(0, 42n), 1: unresolvedChild(1), 2: unresolvedChild(2) } },
      parentBalances: [0n, 0n, 0n, 0n],
      childBalances: [[], [1n, 0n, 0n], []],
    });
    list({ data: plan });
    renderSection();

    expect(screen.getByRole("listitem").textContent).toBe("Greta GerwigWaiting for result");
    expect(screen.queryByRole("button", { name: "Redeem" })).toBeNull();
  });

  it("disables Redeem while a run is pending and while the list is read again", () => {
    list({ data: planFor() });
    run(true);
    const { unmount } = renderSection();
    expect(screen.getByRole("button", { name: "Redeem" })).toBeDisabled();
    unmount();

    list({ data: planFor(), isFetching: true });
    run(false);
    renderSection();
    expect(screen.getByRole("button", { name: "Redeem" })).toBeDisabled();
  });

  it("says the read failed and offers to read again", () => {
    list({ isError: true });
    renderSection();

    expect(screen.getByText("Could not read what your trade wallet can redeem.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Read again" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("shows nothing when nothing redeems or waits, before a read, or without an account", () => {
    for (const state of [
      { data: planFor({ parentBalances: [], childBalances: [] }) },
      { data: undefined },
      { data: planFor(), owner: undefined },
    ]) {
      list(state);
      const { container, unmount } = renderSection();
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });
});
