import { describe, expect, it, vi } from "vitest";

import { planFor } from "@/features/resolution/redeem/__tests__/support/session";

import { useRedeemFromTradeWallet } from "../useTradeWalletRedeem";
import { renderPopup, resetHooks, tradeList } from "./support/redeemPopup";

vi.mock("../useTradeWalletRedeem", () => ({
  useTradeWalletRedeem: vi.fn(),
  useRedeemFromTradeWallet: vi.fn(),
  useTradeWalletOwner: vi.fn(),
}));
vi.mock("../useWalletRedeem", () => ({ useWalletRedeem: vi.fn(), useWalletRedeemRun: vi.fn() }));

describe("the trade wallet's send under the popup", () => {
  it("asks the hook for no toasts, since the popup's status line says each stage", () => {
    resetHooks();
    tradeList({ data: planFor() });
    renderPopup();

    expect(vi.mocked(useRedeemFromTradeWallet)).toHaveBeenCalledWith({ toasts: false });
  });
});
