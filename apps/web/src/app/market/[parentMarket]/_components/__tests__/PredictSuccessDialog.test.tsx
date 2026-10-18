import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PredictSuccessDialog } from "../PredictSuccessDialog";

/* A visitor already subscribed by default, so the dialog renders without the sign-in flow. */
let atlas: Record<string, unknown> = {};
vi.mock("@kleros/kleros-app", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@kleros/kleros-app")>()),
  useAtlasProvider: () => atlas,
}));

let address: string | undefined;
vi.mock("wagmi", () => ({ useAccount: () => ({ address }) }));

beforeEach(() => {
  atlas = { user: { email: "visitor@example.com" }, userExists: true };
  address = "0xa11ce000000000000000000000000000000a11ce";
});

describe("PredictSuccessDialog", () => {
  it.each([
    [["Hanoi"], "1 estimate could not be traded: Hanoi."],
    [["Berlin", "Hanoi"], "2 estimates could not be traded: Berlin, Hanoi."],
  ])("names what it left out as the popup words it: %j", (leftOut, line) => {
    render(<PredictSuccessDialog isOpen leftOut={leftOut} onClose={vi.fn()} />);

    expect(screen.getByText(line)).toBeInTheDocument();
  });

  it("is named by its heading", () => {
    render(<PredictSuccessDialog isOpen leftOut={[]} onClose={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "Prediction placed" })).toBeInTheDocument();
  });

  it("offers the email once to a visitor not yet subscribed, without a line restating its heading", () => {
    atlas = { userExists: false, isVerified: false, isSigningIn: false, authoriseUser: vi.fn() };
    render(<PredictSuccessDialog isOpen leftOut={[]} onClose={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Get an email when the market resolves" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in to subscribe" })).toBeInTheDocument();
    expect(screen.queryByText(/when this market resolves/)).toBeNull();
  });

  it("closes on its wide button, the dialog's one action for a visitor already subscribed", async () => {
    const onClose = vi.fn();
    render(<PredictSuccessDialog isOpen leftOut={[]} onClose={onClose} />);
    const close = screen.getByRole("button", { name: "Close" });

    expect(close).not.toHaveAttribute("data-quiet");
    await userEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("quiets Close beside the sign-in, which is the action there", () => {
    atlas = { userExists: false, isVerified: false, isSigningIn: false, authoriseUser: vi.fn() };
    render(<PredictSuccessDialog isOpen leftOut={[]} onClose={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Close" })).toHaveAttribute("data-quiet", "true");
  });

  it("keeps the sign-in's label beside a spinner while the wallet signs, and cannot be pressed", () => {
    atlas = { userExists: false, isVerified: false, isSigningIn: true, authoriseUser: vi.fn() };
    render(<PredictSuccessDialog isOpen leftOut={[]} onClose={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Signing in…" });

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("data-busy", "true");
    expect(within(button).getByText("Signing in…")).not.toHaveClass("invisible");
    expect(within(button).getByTestId("predict-spinner")).toBeInTheDocument();
  });

  it("asks the wallet to sign once when the sign-in is pressed", async () => {
    const authoriseUser = vi.fn().mockResolvedValue(undefined);
    atlas = { userExists: false, isVerified: false, isSigningIn: false, authoriseUser };
    render(<PredictSuccessDialog isOpen leftOut={[]} onClose={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Sign in to subscribe" }));
    expect(authoriseUser).toHaveBeenCalledTimes(1);
  });

  it("cannot be pressed to sign in with no wallet connected", () => {
    address = undefined;
    atlas = { userExists: false, isVerified: false, isSigningIn: false, authoriseUser: vi.fn() };
    render(<PredictSuccessDialog isOpen leftOut={[]} onClose={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Sign in to subscribe" })).toBeDisabled();
  });
});
