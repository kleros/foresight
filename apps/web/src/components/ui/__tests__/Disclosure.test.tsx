import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { Disclosure } from "../Disclosure";

describe("Disclosure", () => {
  it("keeps the collapsed body out of the tab order and reveals it on press", async () => {
    render(
      <Disclosure title="Details">
        <input aria-label="Inside" />
      </Disclosure>,
    );

    const button = screen.getByRole("button", { name: "Details" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("textbox", { name: "Inside" })).toBeNull();

    await userEvent.click(button);

    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("textbox", { name: "Inside" })).toBeInTheDocument();
  });

  it("gives each disclosure its own id for the body it controls", () => {
    render(
      <>
        <Disclosure title="One">a</Disclosure>
        <Disclosure title="Two">b</Disclosure>
      </>,
    );

    const [one, two] = screen.getAllByRole("button").map((b) => b.getAttribute("aria-controls"));
    expect(one).not.toBe(two);
  });
});
