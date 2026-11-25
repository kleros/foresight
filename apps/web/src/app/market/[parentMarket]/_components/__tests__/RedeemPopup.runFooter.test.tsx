import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { planFor } from "@/features/resolution/redeem/__tests__/support/session";
import type { RedeemProgress } from "@/features/resolution/redeem/run";

import {
  handle,
  mutateAsync,
  openPopup,
  renderPopup,
  resetHooks,
  tradeList,
  tradeRun,
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

beforeEach(() => {
  resetHooks();
  walletList({ data: walletRead() });
});

const footerOf = (dialog: HTMLElement) => dialog.querySelector(".predict-footer") as HTMLElement;
const footerButtons = (dialog: HTMLElement) =>
  within(footerOf(dialog))
    .getAllByRole("button")
    .map((button) => button.textContent);

/** The status callout sits between the scroll body and the footer, so it shows with the button. */
function statusAboveFooter(dialog: HTMLElement) {
  const status = within(dialog).getByRole("status");
  expect(footerOf(dialog).previousElementSibling).toBe(status);
  return status;
}

function openOn(progress: RedeemProgress) {
  walletRun(progress);
  renderPopup();
  return openPopup();
}

describe("the Redeem popup's footer while the connected wallet's run goes (F1, F24)", () => {
  it("says to confirm in the wallet on a busy button while it signs", () => {
    const dialog = openOn({ stage: "signing" });

    expect(footerButtons(dialog)).toEqual(["Confirm in your wallet"]);
    expect(within(footerOf(dialog)).getByRole("button")).toBeDisabled();
    expect(within(footerOf(dialog)).getByTestId("predict-spinner")).toBeInTheDocument();
    expect(statusAboveFooter(dialog)).toHaveTextContent("Confirm the redeem in your wallet.");
  });

  it("says it is confirming once sent, and can be closed while the sent redeem confirms (F27)", () => {
    const dialog = openOn({ stage: "confirming" });

    expect(footerButtons(dialog)).toEqual(["Confirming…"]);
    expect(statusAboveFooter(dialog)).toHaveTextContent("Waiting for the redeem to confirm.");
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeEnabled();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("cannot be closed while the wallet asks to sign", () => {
    const dialog = openOn({ stage: "signing" });

    expect(within(dialog).getByRole("button", { name: "Close" })).toBeDisabled();
  });
});

describe("the Redeem popup's footer once the connected wallet's run stops (F2, F36, F5, F27)", () => {
  it("shows a declined run's reason over the footer in the error tone, the footer's button trying again", () => {
    const dialog = openOn({ stage: "halted", failure: { reason: "rejected", retryable: true } });

    const status = statusAboveFooter(dialog);
    expect(status).toHaveTextContent("You declined the request in your wallet.");
    expect(status).toHaveAttribute("data-tone", "error");
    expect(footerButtons(dialog)).toEqual(["Start over", "Try again"]);
    fireEvent.click(within(footerOf(dialog)).getByRole("button", { name: "Try again" }));
    expect(handle.retry).toHaveBeenCalled();
  });

  it("resumes a stored run from the footer, with Start over beside it", () => {
    const dialog = openOn({ stage: "review" });

    expect(statusAboveFooter(dialog)).toHaveAttribute("data-tone", "warning");
    expect(footerButtons(dialog)).toEqual(["Start over", "Resume"]);
    fireEvent.click(within(footerOf(dialog)).getByRole("button", { name: "Resume" }));
    expect(handle.resume).toHaveBeenCalled();
  });

  it("makes Start over the footer's button where the stop cannot be retried", () => {
    const dialog = openOn({ stage: "halted", failure: { reason: "changed", retryable: false } });

    expect(footerButtons(dialog)).toEqual(["Start over"]);
    fireEvent.click(within(footerOf(dialog)).getByRole("button", { name: "Start over" }));
    expect(handle.reset).toHaveBeenCalled();
  });

  it("asks before letting go of a held send, in the footer", () => {
    const dialog = openOn({ stage: "halted", failure: { reason: "held", retryable: true }, holdsSend: true });

    fireEvent.click(within(footerOf(dialog)).getByRole("button", { name: "Start over" }));
    expect(within(footerOf(dialog)).getByRole("alert")).toBeInTheDocument();
    expect(footerButtons(dialog)).toEqual(["Start over", "Back"]);
    expect(handle.discard).not.toHaveBeenCalled();
  });

  it("holds no Kleros small buttons in the scroll body (F18, F25)", () => {
    const dialog = openOn({ stage: "halted", failure: { reason: "rejected", retryable: true } });

    const outsideFooter = within(dialog)
      .getAllByRole("button")
      .filter((button) => !footerOf(dialog).contains(button) && button.getAttribute("aria-label") !== "Close")
      // a row's help icon is a tooltip trigger, not a Kleros button
      .filter((button) => !button.getAttribute("aria-label")?.startsWith("About "));
    expect(outsideFooter.map((button) => button.textContent)).toEqual([]);
  });
});

describe("the Redeem popup's trade wallet leg, in the popup itself (F4, F19, F23)", () => {
  beforeEach(() => tradeList({ data: planFor() }));

  it("says the trade wallet's batch waits on the wallet while it is pending", () => {
    tradeRun({ isPending: true, stage: "signing" });
    renderPopup();
    const dialog = openPopup();

    expect(footerButtons(dialog)).toEqual(["Confirm in your wallet"]);
    expect(statusAboveFooter(dialog)).toHaveTextContent("Confirm the trade wallet's redeem in your wallet.");
  });

  it("says why the trade wallet's batch stopped, in the dialog's status, and tries it again from the footer", async () => {
    tradeRun({ failure: { text: "You declined in your wallet.", tone: "error" } });
    renderPopup();
    const dialog = openPopup();

    const status = statusAboveFooter(dialog);
    expect(status).toHaveTextContent("You declined in your wallet.");
    expect(status).toHaveAttribute("data-tone", "error");
    fireEvent.click(within(footerOf(dialog)).getByRole("button", { name: "Try again" }));
    await vi.waitFor(() => expect(mutateAsync).toHaveBeenCalled());
  });
});
