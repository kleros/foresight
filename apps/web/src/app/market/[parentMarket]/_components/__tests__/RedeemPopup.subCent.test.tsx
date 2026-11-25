import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { planFor } from "@/features/resolution/redeem/__tests__/support/session";

import {
  handle,
  mutateAsync,
  NOTHING,
  NOTHING_IN_WALLET,
  openPopup,
  popup,
  renderPopup,
  resetHooks,
  tradeList,
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

const DUST = "less than 0.01 sDAI";
/** Plans that pay a few wei: the trade wallet's and the connected wallet's. */
const tradeDust = () => planFor({ parentBalances: [3n, 0n, 0n, 0n], childBalances: [] });
const walletDust = () => walletRead({ parentBalances: [3n, 0n, 0n, 0n], childBalances: [] });

beforeEach(resetHooks);

describe("a payout under one cent reads the same everywhere it shows", () => {
  it("names it on the trigger and on both destination lines", () => {
    const [trade, wallet] = [tradeDust(), walletDust()];
    expect(trade.payout > 0n && trade.payout < 10n ** 16n).toBe(true);
    expect(wallet.plan.calls.length).toBeGreaterThan(0);
    tradeList({ data: trade });
    walletList({ data: wallet });
    renderPopup();

    expect(screen.getByRole("button", { name: `Redeem ${DUST}` })).toBeInTheDocument();
    const dialog = openPopup();
    expect(within(dialog).getByText(`${DUST} goes to your trade wallet.`)).toBeInTheDocument();
    expect(within(dialog).getByText(`${DUST} goes to your wallet.`)).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent("0.00 sDAI");
  });

  it("names it on the receipt and on the page's Redeemed note", async () => {
    tradeList({ data: tradeDust() });
    walletList({ data: NOTHING_IN_WALLET() });
    const { rerender } = render(popup());
    const dialog = openPopup();
    fireEvent.click(within(dialog).getByRole("button", { name: "Redeem" }));
    await vi.waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    await act(async () => {});
    tradeList({ data: NOTHING });
    rerender(popup());

    expect(dialog).toHaveTextContent(`${DUST} from your trade wallet, to your trade wallet.`);
    expect(within(dialog).getByRole("status")).toHaveTextContent(`Redeemed ${DUST}.`);
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(screen.getByText(`Redeemed ${DUST}`)).toBeInTheDocument();
  });

  it("leaves out the receipt line of a wallet that redeemed nothing", async () => {
    const empty = walletRead();
    const read = { ...empty, plan: { ...empty.plan, payout: 0n } };
    tradeList({ data: planFor() });
    walletList({ data: read });
    const { rerender } = render(popup());
    const dialog = openPopup();
    fireEvent.click(within(dialog).getByRole("button", { name: "Redeem" }));
    await vi.waitFor(() => expect(handle.start).toHaveBeenCalled());
    walletRun({ stage: "signing" });
    rerender(popup());
    tradeList({ data: NOTHING });
    walletList({ data: NOTHING_IN_WALLET() });
    walletRun({ stage: "complete" });
    rerender(popup());

    expect(within(dialog).getByRole("heading", { name: "Redeemed" })).toBeInTheDocument();
    expect(dialog).toHaveTextContent("from your trade wallet");
    expect(dialog).not.toHaveTextContent("from your wallet");
  });
});
