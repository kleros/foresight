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
    [["Hanoi"], "Could not be traded: Hanoi."],
    [["Berlin", "Hanoi"], "Could not be traded: Berlin, Hanoi."],
  ])("names what it left out: %j", (leftOut, line) => {
    render(<PredictSuccessDialog isOpen optionNoun="city" leftOut={leftOut} onClose={vi.fn()} />);

    expect(screen.getByText(line)).toBeInTheDocument();
  });

  it("counts what was placed out of every estimate when some were left out", () => {
    render(
      <PredictSuccessDialog
        isOpen
        optionNoun="city"
        placed={{ estimates: 2, amount: 10n * 10n ** 18n, symbol: "sDAI", decimals: 18 }}
        leftOut={["Nairobi", "Montevideo"]}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("2 of 4 estimates · 10 sDAI")).toBeInTheDocument();
  });

  it("is named by its heading", () => {
    render(<PredictSuccessDialog isOpen optionNoun="city" leftOut={[]} onClose={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "Prediction placed" })).toBeInTheDocument();
  });

  it("offers the email once to a visitor not yet subscribed, without a line restating its heading", () => {
    atlas = { userExists: false, isVerified: false, isSigningIn: false, authoriseUser: vi.fn() };
    render(<PredictSuccessDialog isOpen optionNoun="city" leftOut={[]} onClose={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Get an email when the market resolves" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in to subscribe" })).toBeInTheDocument();
    expect(screen.queryByText(/when this market resolves/)).toBeNull();
  });

  it("closes on a quiet wide button for a visitor already subscribed, as nothing is at stake", async () => {
    const onClose = vi.fn();
    render(<PredictSuccessDialog isOpen optionNoun="city" leftOut={[]} onClose={onClose} />);
    const close = screen.getByRole("button", { name: "Close" });

    expect(close).toHaveAttribute("data-quiet", "true");
    await userEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("makes Close a text action beside the sign-in, which is the one action there", async () => {
    atlas = { userExists: false, isVerified: false, isSigningIn: false, authoriseUser: vi.fn() };
    const onClose = vi.fn();
    render(<PredictSuccessDialog isOpen optionNoun="city" leftOut={[]} onClose={onClose} />);
    const close = screen.getByRole("button", { name: "Close" });

    expect(close).not.toHaveClass("predict-cta");
    expect(document.querySelectorAll(".predict-cta")).toHaveLength(1);
    await userEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("says what was placed under its title", () => {
    render(
      <PredictSuccessDialog
        isOpen
        optionNoun="city"
        placed={{ estimates: 2, amount: 10n * 10n ** 18n, symbol: "sDAI", decimals: 18 }}
        leftOut={[]}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("2 estimates · 10 sDAI")).toBeInTheDocument();
  });

  it("names only the estimates when nothing was paid", () => {
    render(
      <PredictSuccessDialog
        isOpen
        optionNoun="city"
        placed={{ estimates: 1, symbol: "sDAI", decimals: 18 }}
        leftOut={[]}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("1 estimate")).toBeInTheDocument();
  });

  it("names the subscribed email in one sentence, with a link to change it in Settings", () => {
    render(<PredictSuccessDialog isOpen optionNoun="city" leftOut={[]} onClose={vi.fn()} />);

    expect(screen.getByText(/^You'll get an email at/)).toHaveTextContent(
      "You'll get an email at visitor@example.com when the market resolves.",
    );
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("link", { name: "Change in Settings" })).toHaveAttribute(
      "href",
      "/settings?tab=notifications",
    );
  });

  it.each([
    [false, true],
    [true, false],
    [undefined, false],
  ])("warns the email will not arrive when isEmailVerified is %s: %s", (isEmailVerified, warns) => {
    atlas = { user: { email: "visitor@example.com", isEmailVerified }, userExists: true };
    render(<PredictSuccessDialog isOpen optionNoun="city" leftOut={[]} onClose={vi.fn()} />);

    expect(Boolean(screen.queryByText("Confirm your email first, or it will not arrive."))).toBe(warns);
    expect(screen.getByRole("link", { name: warns ? "Confirm in Settings" : "Change in Settings" })).toHaveAttribute(
      "href",
      "/settings?tab=notifications",
    );
  });

  it("keeps the sign-in's label beside a spinner while the wallet signs, and cannot be pressed", () => {
    atlas = { userExists: false, isVerified: false, isSigningIn: true, authoriseUser: vi.fn() };
    render(<PredictSuccessDialog isOpen optionNoun="city" leftOut={[]} onClose={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Signing in…" });

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("data-busy", "true");
    expect(within(button).getByText("Signing in…")).not.toHaveClass("invisible");
    expect(within(button).getByTestId("predict-spinner")).toBeInTheDocument();
  });

  it("asks the wallet to sign once when the sign-in is pressed", async () => {
    const authoriseUser = vi.fn().mockResolvedValue(undefined);
    atlas = { userExists: false, isVerified: false, isSigningIn: false, authoriseUser };
    render(<PredictSuccessDialog isOpen optionNoun="city" leftOut={[]} onClose={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Sign in to subscribe" }));
    expect(authoriseUser).toHaveBeenCalledTimes(1);
  });

  it("cannot be pressed to sign in with no wallet connected", () => {
    address = undefined;
    atlas = { userExists: false, isVerified: false, isSigningIn: false, authoriseUser: vi.fn() };
    render(<PredictSuccessDialog isOpen optionNoun="city" leftOut={[]} onClose={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Sign in to subscribe" })).toBeDisabled();
  });

  it("says where the position shows, in the market's own word for an option", () => {
    render(<PredictSuccessDialog isOpen optionNoun="city" leftOut={[]} onClose={vi.fn()} />);

    expect(screen.getByText("See your position under each city.")).toBeInTheDocument();
  });

  it("lists the run's steps without links on a chain with no explorer, as on a local node", () => {
    render(
      <PredictSuccessDialog
        isOpen
        optionNoun="city"
        placed={{
          estimates: 2,
          amount: 10n * 10n ** 18n,
          symbol: "sDAI",
          decimals: 18,
          steps: [
            { id: "create-wallet", hash: `0x${"1".repeat(64)}` },
            { id: "deposit", hash: `0x${"2".repeat(64)}` },
            { id: "predict-1", hash: `0x${"3".repeat(64)}` },
          ],
          funds: { toAdd: 10n * 10n ** 18n, symbol: "sDAI", decimals: 18 },
        }}
        leftOut={[]}
        onClose={vi.fn()}
      />,
    );
    const list = screen.getByRole("list", { name: "Transactions" });

    const [wallet, funds, prediction, ...rest] = within(list).getAllByRole("listitem");
    expect(rest).toEqual([]);
    expect(within(wallet!).getByText("Trade wallet created")).toBeInTheDocument();
    expect(within(funds!).getByText("Funds added")).toBeInTheDocument();
    expect(within(funds!).getByText("10 sDAI")).toBeInTheDocument();
    expect(within(prediction!).getByText("Prediction placed")).toBeInTheDocument();
    expect(within(list).queryAllByRole("link")).toEqual([]);
  });
});
