import { fireEvent, render, screen, within } from "@testing-library/react";
import { isAddressEqual } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  childMarket,
  PARENT,
  TWO_WINNERS,
  unresolvedChild,
  valuedChild,
} from "@/features/resolution/redeem/__tests__/support/session";

import { RedeemPopup } from "../RedeemPopup";
import type { WalletRedeemRead } from "../useWalletRedeem";
import { handle, openPopup, resetHooks, SESSION, walletList, walletRead } from "./support/redeemPopup";

vi.mock("../useTradeWalletRedeem", () => ({
  useTradeWalletRedeem: vi.fn(),
  useRedeemFromTradeWallet: vi.fn(),
  useTradeWalletOwner: vi.fn(),
}));
vi.mock("../useWalletRedeem", () => ({ useWalletRedeem: vi.fn(), useWalletRedeemRun: vi.fn() }));

/** Listed out of outcome order, so an option found by its place in the list is the wrong one. */
const OPTIONS = [
  { market: childMarket(2), outcomeIndex: 2, name: "Christopher Nolan" },
  { market: childMarket(0), outcomeIndex: 0, name: "Denis Villeneuve" },
  { market: childMarket(1), outcomeIndex: 1, name: "Greta Gerwig" },
];

/** sDAI base units cut to cents, as the popup shows a payout. */
const sDai = (value: bigint) => {
  const hundredths = value / 10n ** 16n;
  return `${(hundredths / 100n).toLocaleString("en-US")}.${String(hundredths % 100n).padStart(2, "0")} sDAI`;
};

function renderAndOpen() {
  render(
    <RedeemPopup
      session={SESSION}
      parent={TWO_WINNERS.parent}
      parentMarket={PARENT}
      options={OPTIONS}
      pnl={undefined}
      noun="directors"
    />,
  );
  return openPopup();
}

const rows = () => within(screen.getByRole("list", { name: "Your wallet" })).getAllByRole("listitem");
const rowNamed = (name: string) => rows().find((row) => within(row).queryByText(name) !== null)!;

/** The shown plan has several parts whose payouts differ from each other and from the total. */
function expectDistinctPayouts({ plan }: WalletRedeemRead) {
  const payouts = plan.parts.map((part) => part.payout);
  expect(payouts.length).toBeGreaterThan(1);
  expect(new Set(payouts).size).toBe(payouts.length);
  expect(payouts).not.toContain(plan.payout);
}

beforeEach(resetHooks);

describe("the Redeem popup's connected wallet amounts", () => {
  it("says the plan's total goes to the wallet", () => {
    const shown = walletRead();
    expectDistinctPayouts(shown);
    walletList({ data: shown });
    renderAndOpen();

    expect(screen.getByText(/goes to your wallet\.$/)).toHaveTextContent(
      `${sDai(shown.plan.payout)} goes to your wallet.`,
    );
  });

  it("shows each part's own payout on its row", () => {
    const shown = walletRead();
    expectDistinctPayouts(shown);
    walletList({ data: shown });
    renderAndOpen();

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
    const shown = walletRead({
      resolution: { parent: TWO_WINNERS.parent, children: { 0: valuedChild(0, 42n), 1: unresolvedChild(1) } },
    });
    expect(shown.plan.waiting).toEqual([1]);
    walletList({ data: shown });
    renderAndOpen();

    const waiting = rows().filter((row) => within(row).queryByText("Waiting for result") !== null);
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toHaveTextContent("Greta Gerwig");
    expect(waiting[0]).not.toHaveTextContent(/Christopher Nolan|Denis Villeneuve/);
  });

  it("holds Redeem while the list is read again", () => {
    walletList({ data: walletRead(), isFetching: true });
    const dialog = renderAndOpen();

    const redeem = within(dialog).getByRole("button", { name: "Redeem" });
    expect(redeem).toBeDisabled();
    fireEvent.click(redeem);
    expect(handle.start).not.toHaveBeenCalled();
  });
});
