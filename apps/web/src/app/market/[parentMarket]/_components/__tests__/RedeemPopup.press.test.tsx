import { act, fireEvent, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OWNER, planFor } from "@/features/resolution/redeem/__tests__/support/session";

import {
  handle,
  mutateAsync,
  openPopup,
  renderPopup,
  resetHooks,
  SESSION,
  tradeList,
  walletList,
  walletRead,
} from "./support/redeemPopup";

vi.mock("../useTradeWalletRedeem", () => ({
  useTradeWalletRedeem: vi.fn(),
  useRedeemFromTradeWallet: vi.fn(),
  useTradeWalletOwner: vi.fn(),
}));
vi.mock("../useWalletRedeem", () => ({ useWalletRedeem: vi.fn(), useWalletRedeemRun: vi.fn() }));

function deferred() {
  let resolve!: (value: { status: string }) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<{ status: string }>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

beforeEach(resetHooks);

describe("one press of the popup's Redeem", () => {
  it("sends the trade wallet's batch, then starts the connected wallet's run with what was shown", async () => {
    const trade = planFor();
    const wallet = walletRead();
    tradeList({ data: trade });
    walletList({ data: wallet });
    const sent = deferred();
    mutateAsync.mockReturnValueOnce(sent.promise);
    renderPopup();

    fireEvent.click(within(openPopup()).getByRole("button", { name: "Redeem" }));

    expect(mutateAsync).toHaveBeenCalledWith({ shown: trade, owner: OWNER, session: SESSION, payTo: undefined });
    expect(handle.start).not.toHaveBeenCalled();
    await act(async () => sent.resolve({ status: "success" }));
    expect(handle.start).toHaveBeenCalledTimes(1);
    expect(handle.start).toHaveBeenCalledWith(wallet.input);
  });

  it("starts no wallet run when the trade wallet's batch is not sent", async () => {
    tradeList({ data: planFor() });
    walletList({ data: walletRead() });
    const sent = deferred();
    mutateAsync.mockReturnValueOnce(sent.promise);
    renderPopup();

    fireEvent.click(within(openPopup()).getByRole("button", { name: "Redeem" }));
    await act(async () => sent.reject(new Error("declined")));

    expect(handle.start).not.toHaveBeenCalled();
  });

  it("starts only the wallet's run when the trade wallet holds nothing to redeem", async () => {
    const wallet = walletRead();
    walletList({ data: wallet });
    renderPopup();

    fireEvent.click(within(openPopup()).getByRole("button", { name: "Redeem" }));

    await vi.waitFor(() => expect(handle.start).toHaveBeenCalledWith(wallet.input));
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
