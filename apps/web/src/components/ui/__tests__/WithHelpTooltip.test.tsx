import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import WithHelpTooltip from "../WithHelpTooltip";

const HELP = "Holds the money behind your predictions.";

function renderHelp() {
  render(
    <>
      <WithHelpTooltip label="About the trade wallet" tooltipMsg={HELP}>
        <h3>Trade wallet</h3>
      </WithHelpTooltip>
      <button type="button">Elsewhere</button>
    </>,
  );
  return screen.getByRole("button", { name: "About the trade wallet" });
}

describe("WithHelpTooltip", () => {
  it("opens from the keyboard", async () => {
    const help = renderHelp();

    await userEvent.setup().tab();
    expect(help).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent(HELP);
  });

  it("opens on a tap, which shows no hover", async () => {
    const help = renderHelp();

    const icon = help.querySelector("span")!;
    fireEvent.pointerDown(icon, { pointerType: "touch" });
    fireEvent.pointerUp(icon, { pointerType: "touch" });
    expect(await screen.findByRole("tooltip")).toHaveTextContent(HELP);
  });

  it("opens on no mouse click, which hover already covers", () => {
    const help = renderHelp();

    const icon = help.querySelector("span")!;
    fireEvent.pointerDown(icon, { pointerType: "mouse" });
    fireEvent.pointerUp(icon, { pointerType: "mouse" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
