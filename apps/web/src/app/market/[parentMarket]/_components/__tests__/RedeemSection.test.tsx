import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getAddress, type Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RedeemPlan } from "@/features/resolution/redeem/plan";

import { RedeemSection } from "../RedeemSection";
import { useRedeemFromTradeWallet, useTradeWalletRedeem } from "../useTradeWalletRedeem";

vi.mock("../useTradeWalletRedeem", () => ({ useTradeWalletRedeem: vi.fn(), useRedeemFromTradeWallet: vi.fn() }));

const at = (prefix: string): Address => getAddress(`0x${prefix.padEnd(40, "0")}`);
const PARENT = at("b0");
const OPTIONS = [
  { market: at("c1"), outcomeIndex: 0, name: "Denis Villeneuve" },
  { market: at("c2"), outcomeIndex: 1, name: "Greta Gerwig" },
];
const SESSION = { sessionFactory: at("5f"), sessionId: 3n };

const PLAN: RedeemPlan = {
  parts: [
    { market: PARENT, payout: 2_500_000_000_000_000_001n },
    { market: OPTIONS[0]!.market, payout: 1_000_000_000_000_000_007n },
  ],
  waiting: [1],
  payout: 3_500_000_000_000_000_008n,
  tx: { to: at("77"), data: "0xb1bdad27" },
};

const mutate = vi.fn();
const refetch = vi.fn();

function answer(query: Partial<ReturnType<typeof useTradeWalletRedeem>>, pending = false) {
  vi.mocked(useTradeWalletRedeem).mockReturnValue({
    data: undefined,
    isError: false,
    isFetching: false,
    refetch,
    ...query,
  } as unknown as ReturnType<typeof useTradeWalletRedeem>);
  vi.mocked(useRedeemFromTradeWallet).mockReturnValue({
    mutate,
    isPending: pending,
  } as unknown as ReturnType<typeof useRedeemFromTradeWallet>);
}

const renderSection = () => render(<RedeemSection session={SESSION} parentMarket={PARENT} options={OPTIONS} />);

const section = () => screen.getByRole("region", { name: "Redeem from your trade wallet" });

beforeEach(() => {
  mutate.mockReset();
  refetch.mockReset();
});

describe("RedeemSection", () => {
  it("lists each part with its payout to the wei, the waiting option, and the total going to the trade wallet", () => {
    answer({ data: PLAN });
    renderSection();

    const rows = within(section()).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Session outcome tokens");
    expect(rows[0]).toHaveTextContent("2.500000000000000001 sDAI");
    expect(rows[1]).toHaveTextContent("Denis Villeneuve");
    expect(rows[1]).toHaveTextContent("1.000000000000000007 sDAI");
    expect(rows[2]).toHaveTextContent("Greta Gerwig");
    expect(rows[2]).toHaveTextContent("Waiting for result");
    expect(section()).toHaveTextContent("3.500000000000000008 sDAI goes to your trade wallet.");
  });

  it("redeems the plan shown, for the session, on Redeem", async () => {
    answer({ data: PLAN });
    renderSection();

    await userEvent.click(within(section()).getByRole("button", { name: "Redeem" }));

    expect(mutate).toHaveBeenCalledExactlyOnceWith({ plan: PLAN, session: SESSION });
  });

  it.each([
    { while: "the list is read again", query: { data: PLAN, isFetching: true }, pending: false },
    { while: "a redeem is running", query: { data: PLAN }, pending: true },
  ])("holds Redeem while $while", ({ query, pending }) => {
    answer(query, pending);
    renderSection();

    expect(within(section()).getByRole("button", { name: "Redeem" })).toBeDisabled();
  });

  it("lists only the waiting option, with no Redeem, when nothing is redeemable yet", () => {
    answer({ data: { parts: [], waiting: [1], payout: 0n, tx: null } });
    renderSection();

    expect(section()).toHaveTextContent("Greta Gerwig");
    expect(section()).toHaveTextContent("Waiting for result");
    expect(within(section()).queryByRole("button", { name: "Redeem" })).toBeNull();
  });

  it("shows nothing when there is nothing to redeem or wait for, or no resolved session", () => {
    answer({ data: { parts: [], waiting: [], payout: 0n, tx: null } });
    const { unmount } = renderSection();
    expect(screen.queryByRole("region")).toBeNull();
    unmount();

    answer({ data: PLAN });
    render(<RedeemSection session={undefined} parentMarket={PARENT} options={OPTIONS} />);
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("says a failed read failed, offers no Redeem, and reads again on request", async () => {
    answer({ isError: true });
    renderSection();

    expect(section()).toHaveTextContent("Could not read what your trade wallet can redeem.");
    expect(within(section()).queryByRole("button", { name: "Redeem" })).toBeNull();
    await userEvent.click(within(section()).getByRole("button", { name: "Read again" }));
    expect(refetch).toHaveBeenCalledOnce();
  });
});
