import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PredictSuccessDialog } from "../PredictSuccessDialog";

/* A visitor already subscribed, so the dialog renders without the sign-in flow. */
vi.mock("@kleros/kleros-app", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@kleros/kleros-app")>()),
  useAtlasProvider: () => ({ user: { email: "visitor@example.com" }, userExists: true }),
}));

describe("PredictSuccessDialog", () => {
  it("is named by its heading", () => {
    render(<PredictSuccessDialog isOpen leftOut={[]} onClose={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "Prediction placed" })).toBeInTheDocument();
  });
});
