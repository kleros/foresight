import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Modal } from "../Modal";
import WithHelpTooltip from "../WithHelpTooltip";

/** The overlay is the dialog's outermost ancestor carrying a `z-N` class: the layer it is stacked on. */
function overlayLayers(dialog: Element): string[] {
  let layers: string[] = [];
  for (let node: Element | null = dialog; node; node = node.parentElement) {
    const found = (node.getAttribute("class") ?? "").split(/\s+/).filter((name) => /^z-\d+$/.test(name));
    if (found.length > 0) layers = found;
  }
  return layers;
}

describe("Modal", () => {
  it("lays its overlay on z-40, over the sticky header's z-30", () => {
    render(<Modal isOpen ariaLabel="Predict" />);

    expect(overlayLayers(screen.getByRole("dialog", { name: "Predict" }))).toContain("z-40");
  });

  it("leaves a menu that opens from the header on the library's z-20, under it", () => {
    render(<Modal isOpen belowHeader ariaLabel="Menu" />);

    expect(overlayLayers(screen.getByRole("dialog", { name: "Menu" }))).toEqual(["z-20"]);
  });
});

describe("Modal dismissal", () => {
  function renderDismissable() {
    const onOpenChange = vi.fn();
    render(
      <Modal isOpen isDismissable onOpenChange={onOpenChange} ariaLabel="Redeem">
        <WithHelpTooltip label="About this row" tooltipMsg="What the row holds." />
      </Modal>,
    );
    return onOpenChange;
  }
  const press = (target: Element) => {
    fireEvent.pointerDown(target, { pointerType: "touch", button: 0 });
    fireEvent.pointerUp(target, { pointerType: "touch", button: 0 });
  };

  it("stays open when a tap lands on a tooltip it opened, which is portalled outside it", async () => {
    const onOpenChange = renderDismissable();
    await userEvent.setup().tab();

    press(await screen.findByRole("tooltip", { hidden: true }));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("still closes on a press outside it", () => {
    const onOpenChange = renderDismissable();

    press(document.body);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
