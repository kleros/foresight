import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { planFor, resolvedParent, TWO_WINNERS, WAD } from "@/features/resolution/redeem/__tests__/support/session";
import type { RealisedPnl } from "@/features/resolution/utils/realisedPnl";

import { openPopup, renderPopup, resetHooks, tradeList } from "./support/redeemPopup";

vi.mock("../useTradeWalletRedeem", () => ({
  useTradeWalletRedeem: vi.fn(),
  useRedeemFromTradeWallet: vi.fn(),
  useTradeWalletOwner: vi.fn(),
}));
vi.mock("../useWalletRedeem", () => ({ useWalletRedeem: vi.fn(), useWalletRedeemRun: vi.fn() }));

beforeEach(resetHooks);

const CENT = 10n ** 16n;
const pnlWith = (waiting: number[]): RealisedPnl => ({
  options: { 0: { status: "settled", cost: WAD, payout: 3n * WAD, pnl: 2n * WAD } },
  session: { cost: 200n * CENT, payout: 323n * CENT, pnl: 123n * CENT, waiting },
});
const WINNING_TOKENS_HELP =
  "Outcome tokens of this session's selected options, held directly, not inside an option's own market. Each pays out by the session's result.";

/** The open tooltip; the popup's modal hides the overlay layer from the accessibility tree, so it is found hidden. */
const tooltip = () => screen.findByRole("tooltip", { hidden: true });

/** Tabs until `target` holds focus, as a keyboard user reaches it. */
async function tabTo(target: HTMLElement) {
  const user = userEvent.setup();
  for (let step = 0; step < 20 && document.activeElement !== target; step++) await user.tab();
  expect(target).toHaveFocus();
}
const sessionLine = (dialog: HTMLElement) =>
  within(dialog).getByText("This session").closest<HTMLElement>("div.rounded-fs-panel")!;

describe("the Redeem popup's session line (spec D21, D22)", () => {
  it("shows what went in and what came back, then the signed P&L", () => {
    tradeList({ data: planFor() });
    renderPopup({ pnl: pnlWith([]) });

    expect(sessionLine(openPopup())).toHaveTextContent("2.00 sDAI→3.23 sDAIP&L:+1.23 sDAI");
  });

  it("says the total leaves out waiting options in a tooltip, not in visible text", async () => {
    tradeList({ data: planFor() });
    renderPopup({ pnl: pnlWith([1]) });
    const dialog = openPopup();

    expect(dialog).not.toHaveTextContent("Excludes directors waiting for their result.");
    const help = within(sessionLine(dialog)).getByRole("button", { name: "About this total" });

    await tabTo(help);
    expect(await tooltip()).toHaveTextContent("Excludes directors waiting for their result.");
    expect(help).toHaveAccessibleDescription("Excludes directors waiting for their result.");
  });

  it("offers no tooltip on the total where nothing waits", () => {
    tradeList({ data: planFor() });
    renderPopup({ pnl: pnlWith([]) });

    expect(within(sessionLine(openPopup())).queryByRole("button", { name: "About this total" })).toBeNull();
  });
});

describe("the Redeem popup's Winning outcome tokens row (spec D22)", () => {
  it("explains the row in a tooltip its help button opens from the keyboard", async () => {
    tradeList({ data: planFor() });
    renderPopup();
    const dialog = openPopup();
    const row = within(dialog).getByText("Winning outcome tokens").closest("li")!;
    const help = within(row).getByRole("button", { name: "About winning outcome tokens" });

    await tabTo(help);
    expect(await tooltip()).toHaveTextContent(WINNING_TOKENS_HELP);
    expect(help).toHaveAccessibleDescription(WINNING_TOKENS_HELP);
  });

  it("offers no tooltip on an INVALID session's refund row", () => {
    const invalid = resolvedParent([0n, 0n, 0n, 1n]);
    tradeList({ data: planFor({ resolution: { parent: invalid, children: TWO_WINNERS.children } }) });
    renderPopup({ parent: invalid });
    const row = within(openPopup()).getByText("Refund (session invalid)").closest("li")!;

    expect(within(row).queryByRole("button")).toBeNull();
  });
});
