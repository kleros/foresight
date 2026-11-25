import type { ReactNode } from "react";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  OTHER_OWNER,
  planFor,
  resolvedParent,
  TWO_WINNERS,
  WAD,
} from "@/features/resolution/redeem/__tests__/support/session";
import type { RealisedPnl } from "@/features/resolution/utils/realisedPnl";

import {
  NOTHING_IN_WALLET,
  openPopup,
  popup,
  renderPopup,
  resetHooks,
  tradeList,
  tradeOwner,
  walletList,
  walletRead,
  walletRefetch,
} from "./support/redeemPopup";

vi.mock("../useTradeWalletRedeem", () => ({
  useTradeWalletRedeem: vi.fn(),
  useRedeemFromTradeWallet: vi.fn(),
  useTradeWalletOwner: vi.fn(),
}));
vi.mock("../useWalletRedeem", () => ({ useWalletRedeem: vi.fn(), useWalletRedeemRun: vi.fn() }));
vi.mock("@/components/wallet/EnsureChain", () => ({
  default: ({ children }: { children: ReactNode }) => (
    <div data-testid="ensure-chain">
      <button type="button">Switch to Gnosis</button>
      <div hidden>{children}</div>
    </div>
  ),
}));

const cents = (value: bigint) => {
  const hundredths = value / 10n ** 16n;
  return `${(hundredths / 100n).toLocaleString("en-US")}.${String(hundredths % 100n).padStart(2, "0")} sDAI`;
};

beforeEach(() => {
  resetHooks();
});

describe("the Redeem popup's part rows (F8, F21, F9)", () => {
  const TRADE = planFor();
  const PNL: RealisedPnl = {
    options: {
      0: { status: "settled", cost: WAD, payout: 3n * WAD, pnl: 2n * WAD },
      1: { status: "settled", cost: 4n * WAD, payout: WAD, pnl: -3n * WAD },
    },
    session: { cost: 5n * WAD, payout: 4n * WAD, pnl: -WAD, waiting: [] },
  };

  it("shows each payout to the cent, in a right-aligned column of tabular figures with its P&L under it", () => {
    tradeList({ data: TRADE });
    renderPopup({ pnl: PNL });
    const list = within(openPopup()).getByRole("list", { name: "Trade wallet" });

    expect(list).toHaveClass("grid");
    for (const part of TRADE.parts) {
      const payout = within(list).getByText(cents(part.payout));
      expect(payout).toHaveClass("tabular-nums", "text-right", "col-start-2");
    }
    const villeneuve = within(list).getByText("Denis Villeneuve").closest("li")!;
    expect(villeneuve).toHaveClass("grid-cols-subgrid");
    expect(within(villeneuve).getByText("+2.00 sDAI").closest("[data-column=pnl]")).toHaveClass("col-start-2");
    expect(list).not.toHaveTextContent(/\.\d{3,} sDAI/);
  });

  it("names a payout under a cent rather than showing 0.00", () => {
    const dust = planFor({ parentBalances: [3n, 0n, 0n, 0n], childBalances: [] });
    expect(dust.parts.every((part) => part.payout > 0n && part.payout < 10n ** 16n)).toBe(true);
    tradeList({ data: dust });
    renderPopup();
    const list = within(openPopup()).getByRole("list", { name: "Trade wallet" });

    expect(within(list).getAllByText("less than 0.01 sDAI")).toHaveLength(dust.parts.length);
  });

  it("labels the trigger with what both wallets redeem, to the cent", () => {
    const wallet = walletRead();
    tradeList({ data: TRADE });
    walletList({ data: wallet });
    renderPopup();

    expect(screen.getByRole("button", { name: `Redeem ${cents(TRADE.payout + wallet.plan.payout)}` })).toBeVisible();
  });
});

describe("the Redeem popup on a session whose parent resolved INVALID (F33, F12, spec D19)", () => {
  const INVALID = resolvedParent([0n, 0n, 0n, 1n]);

  it("reads the parent part as the session's refund", () => {
    const plan = planFor({ resolution: { parent: INVALID, children: TWO_WINNERS.children } });
    tradeList({ data: plan });
    renderPopup({ parent: INVALID });
    const dialog = openPopup();

    const row = within(dialog).getByText("Refund (session invalid)").closest("li")!;
    expect(row).toHaveTextContent(cents(plan.payout));
    expect(dialog).not.toHaveTextContent("Winning outcome tokens");
  });
});

describe("the Redeem control on another network (F32)", () => {
  it("offers to switch to the redeem chain where the account is connected elsewhere", () => {
    tradeList({ data: undefined, owner: undefined, isWrongChain: true });
    walletList({ data: undefined, owner: undefined });
    renderPopup();

    expect(screen.getByTestId("ensure-chain")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch to Gnosis" })).toBeInTheDocument();
  });

  it("shows nothing on another network before the parent resolved", () => {
    tradeList({ data: undefined, owner: undefined, isWrongChain: true });
    walletList({ data: undefined, owner: undefined });
    const { container } = render(popup({ parent: { resolved: false } }));

    expect(container).toBeEmptyDOMElement();
  });
});

describe("the Redeem popup's read failures and owner line (F37, F14, F13)", () => {
  it("says inside the dialog that the wallet's list could not be read, and what Redeem then covers", () => {
    tradeList({ data: planFor() });
    walletList({ isError: true });
    renderPopup();
    const dialog = openPopup();

    expect(dialog).toHaveTextContent(
      "Could not read what your wallet can redeem. Redeem covers your trade wallet only.",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Read again" }));
    expect(walletRefetch).toHaveBeenCalled();
  });

  it("ties the destination line to the box and to Redeem, and keeps words whole", () => {
    tradeList({ data: planFor() });
    walletList({ data: NOTHING_IN_WALLET() });
    tradeOwner(undefined);
    renderPopup();
    const dialog = openPopup();
    const box = within(dialog).getByRole("checkbox");
    fireEvent.click(box);

    const line = within(dialog).getByText("Reading the trade wallet's owner…");
    expect(box).toHaveAttribute("aria-describedby", line.id);
    expect(within(dialog).getByRole("button", { name: "Redeem" })).toHaveAttribute("aria-describedby", line.id);
    expect(line).toHaveAttribute("aria-live", "polite");
    expect(line).not.toHaveClass("break-all");
  });

  it("breaks only the owner's address, not the sentence around it", () => {
    tradeList({ data: planFor() });
    walletList({ data: NOTHING_IN_WALLET() });
    tradeOwner(OTHER_OWNER);
    renderPopup();
    const dialog = openPopup();
    fireEvent.click(within(dialog).getByRole("checkbox"));

    const address = within(dialog).getByText(OTHER_OWNER);
    expect(address).toHaveClass("break-all");
    expect(address.parentElement).not.toHaveClass("break-all");
  });
});
