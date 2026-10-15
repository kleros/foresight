import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PredictSuccessDialog } from "../PredictSuccessDialog";

/* A visitor already subscribed by default, so the dialog renders without the sign-in flow. */
let atlas: Record<string, unknown> = {};
vi.mock("@kleros/kleros-app", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@kleros/kleros-app")>()),
  useAtlasProvider: () => atlas,
}));

vi.mock("wagmi", () => ({ useAccount: () => ({ address: "0xa11ce000000000000000000000000000000a11ce" }) }));

beforeEach(() => {
  atlas = { user: { email: "visitor@example.com" }, userExists: true };
});

describe("PredictSuccessDialog", () => {
  it("is named by its heading", () => {
    render(<PredictSuccessDialog isOpen leftOut={[]} onClose={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "Prediction placed" })).toBeInTheDocument();
  });

  it("offers the email once to a visitor not yet subscribed, without a line restating its heading", () => {
    atlas = { userExists: false, isVerified: false, isSigningIn: false, authoriseUser: vi.fn() };
    render(<PredictSuccessDialog isOpen leftOut={[]} onClose={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Get an email when it resolves" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in to subscribe" })).toBeInTheDocument();
    expect(screen.queryByText(/when this market resolves/)).toBeNull();
  });
});
