import type { ReactElement } from "react";

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OTHER_OWNER, planFor, WAD } from "@/features/resolution/redeem/__tests__/support/session";
import type { RealisedPnl } from "@/features/resolution/utils/realisedPnl";

import {
  handle,
  mutateAsync,
  NOTHING,
  NOTHING_IN_WALLET,
  openPopup,
  popup,
  resetHooks,
  tradeList,
  tradeOwner,
  walletList,
  walletRead,
  walletRun,
} from "./support/redeemPopup";

vi.mock("../useTradeWalletRedeem", () => ({
  useTradeWalletRedeem: vi.fn(),
  useRedeemFromTradeWallet: vi.fn(),
  useTradeWalletOwner: vi.fn(),
}));
vi.mock("../useWalletRedeem", () => ({ useWalletRedeem: vi.fn(), useWalletRedeemRun: vi.fn() }));

/** sDAI base units cut to cents, as the popup shows an amount. */
const cents = (value: bigint) => {
  const hundredths = value / 10n ** 16n;
  return `${(hundredths / 100n).toLocaleString("en-US")}.${String(hundredths % 100n).padStart(2, "0")} sDAI`;
};

const PNL: RealisedPnl = {
  options: {},
  session: { cost: 5n * WAD, payout: 7n * WAD, pnl: 2n * WAD, waiting: [] },
};

const TRADE = planFor();
const WALLET = walletRead();

beforeEach(() => {
  resetHooks();
  tradeList({ data: TRADE });
  walletList({ data: WALLET });
});

/** Presses Redeem, lets the trade batch land and the wallet's run sign and complete, with both lists read empty after. */
async function redeemBoth(rerender: (ui: ReactElement) => void, dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByRole("button", { name: "Redeem" }));
  await vi.waitFor(() => expect(handle.start).toHaveBeenCalled());
  walletRun({ stage: "signing" });
  rerender(popup({ pnl: PNL }));
  tradeList({ data: NOTHING });
  walletList({ data: NOTHING_IN_WALLET() });
  walletRun({ stage: "complete" });
  rerender(popup({ pnl: PNL }));
}

describe("the Redeem popup after a redeem (F11, F26, F31)", () => {
  it("says what each wallet redeemed, how much and where it went, with the session's P&L", async () => {
    const { rerender } = render(popup({ pnl: PNL }));
    const dialog = openPopup();
    await redeemBoth(rerender, dialog);

    const status = within(dialog).getByRole("status");
    expect(status).toHaveTextContent("Redeemed");
    expect(dialog).toHaveTextContent(`${cents(TRADE.payout)} from your trade wallet, to your trade wallet`);
    expect(dialog).toHaveTextContent(`${cents(WALLET.plan.payout)} from your wallet, to your wallet`);
    expect(dialog).toHaveTextContent("P&L:+2.00 sDAI");
    expect(dialog).not.toHaveTextContent("Nothing left to redeem");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("names the owner a ticked box paid the trade wallet's payout to", async () => {
    walletList({ data: NOTHING_IN_WALLET() });
    tradeOwner(OTHER_OWNER);
    const { rerender } = render(popup());
    const dialog = openPopup();
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Redeem" }));
    await vi.waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    await act(async () => {});
    tradeList({ data: NOTHING });
    rerender(popup());

    expect(dialog).toHaveTextContent(`${cents(TRADE.payout)} from your trade wallet, to ${OTHER_OWNER}`);
  });

  it("keeps focus on the page once Done closes it, though nothing is left to redeem", async () => {
    const { rerender } = render(popup({ pnl: PNL }));
    const dialog = openPopup();
    await redeemBoth(rerender, dialog);

    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    await act(async () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toHaveTextContent(/^Redeemed /);
  });

  it("opens again on the list, not on the last redeem's result", async () => {
    tradeList({ data: TRADE });
    walletList({ data: NOTHING_IN_WALLET() });
    const { rerender } = render(popup());
    let dialog = openPopup();
    fireEvent.click(within(dialog).getByRole("button", { name: "Redeem" }));
    await vi.waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    await act(async () => {});
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    // a new part became redeemable after the redeem, so the trigger is back
    tradeList({ data: TRADE });
    rerender(popup());

    dialog = openPopup();
    expect(within(dialog).queryByText(/^Redeemed/)).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Redeem" })).toBeEnabled();
  });

  it("opens again on the list when the redeem finished after it was closed", async () => {
    tradeList({ data: NOTHING });
    const { rerender } = render(popup());
    let dialog = openPopup();
    fireEvent.click(within(dialog).getByRole("button", { name: "Redeem" }));
    await vi.waitFor(() => expect(handle.start).toHaveBeenCalled());
    walletRun({ stage: "confirming" });
    rerender(popup());
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    walletRun({ stage: "complete" });
    rerender(popup());

    dialog = openPopup();
    expect(within(dialog).queryAllByText(/^Redeemed/)).toEqual([]);
    expect(within(dialog).getByRole("button", { name: "Redeem" })).toBeEnabled();
  });
});
