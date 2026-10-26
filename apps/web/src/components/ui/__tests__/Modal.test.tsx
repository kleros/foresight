import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Modal } from "../Modal";

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
