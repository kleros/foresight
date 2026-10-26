import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import ThemeToggle from "../ThemeToggle";

describe("ThemeToggle", () => {
  it("names the icon-only button after what it does", () => {
    render(<ThemeToggle />);

    expect(screen.getByRole("button", { name: /theme|dark mode|light mode/i })).toBeInTheDocument();
  });
});
