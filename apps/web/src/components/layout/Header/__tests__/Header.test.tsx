import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import Header from "..";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("Header", () => {
  it("names the menu button", () => {
    render(<Header />);

    expect(screen.getByRole("button", { name: /menu/i })).toBeInTheDocument();
  });

  it("names every header button, icon-only ones included", () => {
    render(<Header />);

    for (const button of screen.getAllByRole("button")) {
      expect(button).toHaveAccessibleName();
    }
  });

  it("names the opened menu after itself rather than the library's default", async () => {
    render(<Header />);

    await userEvent.click(screen.getByRole("button", { name: /menu/i }));

    expect(screen.getByRole("dialog", { name: /menu/i })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Modal" })).toBeNull();
  });
});
