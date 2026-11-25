import { fireEvent, screen, within } from "@testing-library/react";
import { getAddress } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  OWNER,
  planFor,
  TWO_WINNERS,
  unresolvedChild,
  valuedChild,
} from "@/features/resolution/redeem/__tests__/support/session";

import {
  mutateAsync,
  NOTHING,
  openPopup,
  popup,
  renderPopup,
  resetHooks,
  SESSION,
  tradeList,
  tradeOwner,
  tradeOwnerCached,
  tradeRefetch,
  tradeRun,
} from "./support/redeemPopup";

vi.mock("../useTradeWalletRedeem", () => ({
  useTradeWalletRedeem: vi.fn(),
  useRedeemFromTradeWallet: vi.fn(),
  useTradeWalletOwner: vi.fn(),
}));
vi.mock("../useWalletRedeem", () => ({ useWalletRedeem: vi.fn(), useWalletRedeemRun: vi.fn() }));

const ONCHAIN_OWNER = getAddress("0x0a22000000000000000000000000000000000bc7");

beforeEach(resetHooks);

const tradeRows = (dialog: HTMLElement) =>
  within(within(dialog).getByRole("list", { name: "Trade wallet" })).getAllByRole("listitem");

describe("the Redeem popup's trade wallet", () => {
  it("lists each part's payout to the wei and redeems the shown list for the owner on one press", () => {
    const plan = planFor();
    tradeList({ data: plan });
    renderPopup();
    const dialog = openPopup();

    expect(tradeRows(dialog).map((row) => row.textContent)).toEqual([
      "Winning outcome tokens5.499999999999999998 sDAI",
      "Denis Villeneuve1.999999999641975311 sDAI",
      "Greta Gerwig1.499999999639506172 sDAI",
    ]);
    expect(plan.parts.map((part) => part.payout)).toEqual([
      5_499_999_999_999_999_998n,
      1_999_999_999_641_975_311n,
      1_499_999_999_639_506_172n,
    ]);
    expect(within(dialog).getByText("8.999999999281481481 sDAI goes to your trade wallet.")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Redeem" }));
    expect(mutateAsync).toHaveBeenCalledWith({ shown: plan, owner: OWNER, session: SESSION, payTo: undefined });
  });

  it("pays the shown owner once the box is ticked, and says where the payout goes", () => {
    const plan = planFor();
    tradeList({ data: plan });
    tradeOwner(ONCHAIN_OWNER);
    renderPopup();
    const dialog = openPopup();

    fireEvent.click(within(dialog).getByRole("checkbox"));
    expect(within(dialog).getByText(`8.999999999281481481 sDAI goes to ${ONCHAIN_OWNER}.`)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Redeem" }));

    expect(mutateAsync).toHaveBeenCalledWith({ shown: plan, owner: OWNER, session: SESSION, payTo: ONCHAIN_OWNER });
  });

  it("pays the trade wallet once the box is unticked or the popup reopens, though the owner stays read", () => {
    const plan = planFor();
    tradeList({ data: plan });
    tradeOwnerCached(ONCHAIN_OWNER);
    renderPopup();
    let dialog = openPopup();

    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("checkbox"));
    expect(within(dialog).getByText("8.999999999281481481 sDAI goes to your trade wallet.")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Redeem" }));
    expect(mutateAsync).toHaveBeenLastCalledWith({ shown: plan, owner: OWNER, session: SESSION, payTo: undefined });

    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    dialog = openPopup();
    fireEvent.click(within(dialog).getByRole("button", { name: "Redeem" }));
    expect(mutateAsync).toHaveBeenLastCalledWith({ shown: plan, owner: OWNER, session: SESSION, payTo: undefined });
  });

  it("holds Redeem while the ticked box's owner is unread", () => {
    tradeList({ data: planFor() });
    tradeOwner(undefined);
    renderPopup();
    const dialog = openPopup();

    fireEvent.click(within(dialog).getByRole("checkbox"));
    expect(within(dialog).getByRole("button", { name: "Redeem" })).toBeDisabled();
  });

  it("lists a held option still waiting for its result, without a button when nothing else redeems", () => {
    const plan = planFor({
      resolution: {
        ...TWO_WINNERS,
        children: { 0: valuedChild(0, 42n), 1: unresolvedChild(1), 2: unresolvedChild(2) },
      },
      parentBalances: [0n, 0n, 0n, 0n],
      childBalances: [[], [1n, 0n, 0n], []],
    });
    expect(plan.waiting).toEqual([1]);
    tradeList({ data: plan });
    renderPopup();

    expect(screen.queryByRole("button", { name: "Redeem" })).toBeNull();
  });

  it("disables Redeem while a run is pending and while the list is read again", () => {
    tradeList({ data: planFor() });
    tradeRun(true);
    const { unmount } = renderPopup();
    expect(within(openPopup()).getByRole("button", { name: "Redeeming…" })).toBeDisabled();
    unmount();

    tradeList({ data: planFor(), isFetching: true });
    tradeRun(false);
    renderPopup();
    expect(within(openPopup()).getByRole("button", { name: "Redeem" })).toBeDisabled();
  });

  it("keeps an open popup through a failed parent read, withdrawing its lists", () => {
    tradeList({ data: planFor() });
    const { rerender } = renderPopup();
    openPopup();

    rerender(popup({ parent: new Error("RPC unavailable") }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Could not read this session's result.")).toBeInTheDocument();
    expect(within(dialog).queryByRole("list", { name: "Trade wallet" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Redeem" })).toBeNull();
  });

  it("says the read failed and offers to read again", () => {
    tradeList({ isError: true });
    renderPopup();

    expect(screen.getByText("Could not read what your trade wallet can redeem.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Read again" }));
    expect(tradeRefetch).toHaveBeenCalledTimes(1);
  });

  it("shows nothing when nothing redeems, before a read, or without an account", () => {
    for (const state of [{ data: NOTHING }, { data: undefined }, { data: planFor(), owner: undefined }]) {
      tradeList(state);
      const { container, unmount } = renderPopup();
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });
});
