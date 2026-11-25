import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  planFor,
  TWO_WINNERS,
  unresolvedChild,
  valuedChild,
  WAD,
} from "@/features/resolution/redeem/__tests__/support/session";
import type { RealisedPnl } from "@/features/resolution/utils/realisedPnl";

import { START_OVER_WARNING } from "../RedeemPopup";
import {
  handle,
  NOTHING,
  NOTHING_IN_WALLET,
  openPopup,
  popup,
  renderPopup,
  resetHooks,
  tradeList,
  walletList,
  walletRead,
  walletRefetch,
  walletRun,
} from "./support/redeemPopup";

vi.mock("../useTradeWalletRedeem", () => ({
  useTradeWalletRedeem: vi.fn(),
  useRedeemFromTradeWallet: vi.fn(),
  useTradeWalletOwner: vi.fn(),
}));
vi.mock("../useWalletRedeem", () => ({ useWalletRedeem: vi.fn(), useWalletRedeemRun: vi.fn() }));

beforeEach(() => {
  resetHooks();
  walletList({ data: walletRead() });
});

describe("the Redeem popup's connected wallet", () => {
  it("lists each part's payout and Redeem signs what it showed", async () => {
    const shown = walletRead();
    walletList({ data: shown });
    renderPopup();
    const dialog = openPopup();

    const rows = within(dialog).getByRole("list", { name: "Your wallet" });
    expect(within(rows).getByText("Winning outcome tokens")).toBeInTheDocument();
    expect(within(rows).getByText("Denis Villeneuve")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Redeem" }));

    await vi.waitFor(() => expect(handle.start).toHaveBeenCalledWith(shown.input));
  });

  it("lists the options it waits for, with no Redeem when nothing pays in either wallet", () => {
    const waiting = walletRead({
      resolution: { parent: TWO_WINNERS.parent, children: { 0: unresolvedChild(0), 1: unresolvedChild(1) } },
      parentBalances: [0n, 0n, 0n, 0n],
    });
    walletList({ data: waiting });
    const { unmount } = renderPopup();
    expect(screen.queryByRole("button", { name: "Redeem" })).toBeNull();
    unmount();

    tradeList({ data: planFor() });
    renderPopup();
    const rows = within(openPopup()).getByRole("list", { name: "Your wallet" });
    expect(within(rows).getAllByText("Waiting for result")).toHaveLength(2);
  });

  it("is hidden while the wallet holds nothing to redeem", () => {
    walletList({ data: NOTHING_IN_WALLET() });
    renderPopup();

    expect(screen.queryByRole("button", { name: "Redeem" })).toBeNull();
  });

  it("is hidden before the parent resolved and with no account on the redeem chain", () => {
    const { container, rerender } = render(popup({ parent: { resolved: false } }));
    expect(container).toBeEmptyDOMElement();

    tradeList({ data: NOTHING, owner: undefined });
    walletList({ data: walletRead(), owner: undefined });
    rerender(popup());
    expect(container).toBeEmptyDOMElement();
  });

  it("offers to read the list again when the read failed", () => {
    walletList({ isError: true });
    renderPopup();

    fireEvent.click(screen.getByRole("button", { name: "Read again" }));
    expect(walletRefetch).toHaveBeenCalled();
  });

  it("says what the run is doing in place of Redeem while it signs", () => {
    walletRun({ stage: "signing" });
    renderPopup();
    const dialog = openPopup();

    expect(within(dialog).getByRole("status")).toHaveTextContent("Confirm the redeem in your wallet.");
    expect(within(dialog).queryByRole("button", { name: "Redeem" })).toBeNull();
  });

  it("carries a stored run on from review", () => {
    walletRun({ stage: "review" });
    renderPopup();

    fireEvent.click(within(openPopup()).getByRole("button", { name: "Continue redeem" }));
    expect(handle.resume).toHaveBeenCalled();
  });

  it("shows a stopped run even once the list is empty", () => {
    walletList({ data: NOTHING_IN_WALLET() });
    walletRun({ stage: "halted", failure: { reason: "rejected", retryable: true } });
    renderPopup();
    const dialog = openPopup();

    expect(within(dialog).getByRole("status")).toHaveTextContent("You declined the request in your wallet.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Try again" }));
    expect(handle.retry).toHaveBeenCalled();
  });

  it("starts over at once a stopped run that holds no send", () => {
    walletRun({ stage: "halted", failure: { reason: "changed", retryable: false } });
    renderPopup();
    const dialog = openPopup();

    expect(within(dialog).queryByRole("button", { name: "Try again" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Start over" }));
    expect(handle.reset).toHaveBeenCalled();
    expect(handle.discard).not.toHaveBeenCalled();
  });

  it.each([
    ["held", true],
    ["batch-unknown", false],
  ] as const)("asks first, then discards, a run stopped as %s holding a send", (reason, retryable) => {
    walletRun({ stage: "halted", failure: { reason, retryable }, holdsSend: true });
    renderPopup();
    const dialog = openPopup();

    fireEvent.click(within(dialog).getByRole("button", { name: "Start over" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent(START_OVER_WARNING);
    expect(handle.discard).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Start over" }));
    expect(handle.discard).toHaveBeenCalledTimes(1);
    expect(handle.reset).not.toHaveBeenCalled();
  });

  it("goes back without discarding", () => {
    walletRun({ stage: "review", holdsSend: true });
    renderPopup();
    const dialog = openPopup();

    fireEvent.click(within(dialog).getByRole("button", { name: "Start over" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Back" }));

    expect(handle.discard).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("button", { name: "Continue redeem" })).toBeInTheDocument();
  });

  it("shows the payout only on the wallet's rows, where the trade wallet's same option shows its P&L (spec D16)", () => {
    const pnl: RealisedPnl = {
      options: { 0: { status: "settled", cost: WAD, payout: 3n * WAD, pnl: 2n * WAD } },
      session: { cost: WAD, payout: 3n * WAD, pnl: 2n * WAD, waiting: [] },
    };
    tradeList({ data: planFor() });
    walletList({ data: walletRead() });
    renderPopup({ pnl });
    const dialog = openPopup();

    const rowOf = (list: string) =>
      within(within(dialog).getByRole("list", { name: list }))
        .getAllByRole("listitem")
        .find((row) => row.textContent?.includes("Denis Villeneuve"))!;
    expect(rowOf("Trade wallet")).toHaveTextContent("P&L:+2.00 sDAI");
    expect(rowOf("Your wallet")).not.toHaveTextContent("P&L");
  });

  it("pays a resolved winner's child part as the planner does", () => {
    const shown = walletRead({
      resolution: { parent: TWO_WINNERS.parent, children: { 0: valuedChild(0, 40n), 1: unresolvedChild(1) } },
    });
    walletList({ data: shown });
    renderPopup();

    expect(within(openPopup()).getByText(/goes to your wallet\.$/)).toBeInTheDocument();
    expect(shown.plan.waiting).toEqual([1]);
  });
});
