import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RedeemProgress } from "@/features/resolution/redeem/run";

import { START_OVER_WARNING } from "../RedeemPopup";
import { handle, openPopup, popup, resetHooks, walletList, walletRead, walletRun } from "./support/redeemPopup";

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

/** Ported from liquidity `startOver.test.tsx`. */
describe("the Redeem popup's Start over", () => {
  it("asks again on a later hold, not carrying an earlier press over a run that went on", () => {
    const held: RedeemProgress = { stage: "halted", failure: { reason: "held", retryable: true }, holdsSend: true };
    walletRun(held);
    const view = render(popup());
    const dialog = openPopup();
    fireEvent.click(within(dialog).getByRole("button", { name: "Start over" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent(START_OVER_WARNING);

    walletRun({ stage: "signing" });
    view.rerender(popup());
    walletRun(held);
    view.rerender(popup());

    expect(within(screen.getByRole("dialog")).queryByRole("alert")).toBeNull();
    expect(handle.discard).not.toHaveBeenCalled();
  });
});
