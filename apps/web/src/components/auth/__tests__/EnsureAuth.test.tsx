import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { errorToast } from "@/utils/toast";

import EnsureAuth from "../EnsureAuth";

const authoriseUser = vi.fn();

vi.mock("@/utils/toast", () => ({ infoToast: vi.fn(), successToast: vi.fn(), errorToast: vi.fn() }));
vi.mock("wagmi", () => ({ useAccount: () => ({ address: "0xa11ce000000000000000000000000000000a11ce" }) }));
vi.mock("@kleros/kleros-app", () => ({
  useAtlasProvider: () => ({ isVerified: false, isSigningIn: false, authoriseUser }),
}));

it("reports a failed sign-in in its own words, not the library's", async () => {
  authoriseUser.mockRejectedValue(new Error("Request failed with status code 500: nonce mismatch"));
  render(
    <EnsureAuth>
      <p>signed in</p>
    </EnsureAuth>,
  );

  await userEvent.click(screen.getByRole("button", { name: "Sign In" }));

  await waitFor(() => expect(errorToast).toHaveBeenCalledWith("Sign-in failed. Try again."));
  expect(errorToast).toHaveBeenCalledOnce();
});
