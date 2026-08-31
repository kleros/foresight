import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ImageLightbox } from "../ImageLightbox";

const FROM = { left: 20, top: 40, width: 40, height: 40 };

describe("ImageLightbox", () => {
  it("shows the image full size, named by its title", () => {
    render(<ImageLightbox src="blob:local-1" alt="The poster" from={FROM} onClose={() => {}} />);

    expect(screen.getByRole("dialog", { name: "The poster" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "The poster" })).toHaveAttribute("src", "blob:local-1");
  });

  it("closes on a click outside the image", async () => {
    const onClose = vi.fn();
    render(<ImageLightbox src="blob:local-1" alt="The poster" from={FROM} onClose={onClose} />);

    await userEvent.click(screen.getByRole("dialog", { name: "The poster" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays open on a click on the image itself", async () => {
    const onClose = vi.fn();
    render(<ImageLightbox src="blob:local-1" alt="The poster" from={FROM} onClose={onClose} />);

    await userEvent.click(screen.getByRole("img", { name: "The poster" }));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(<ImageLightbox src="blob:local-1" alt="The poster" from={FROM} onClose={onClose} />);

    await userEvent.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("takes focus while open and hands it back to its opener on close", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();

    const { unmount } = render(<ImageLightbox src="blob:local-1" alt="The poster" from={FROM} onClose={() => {}} />);

    expect(screen.getByRole("dialog", { name: "The poster" })).toHaveFocus();
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("gives the page its scroll back on close", () => {
    const { unmount } = render(<ImageLightbox src="blob:local-1" alt="The poster" from={FROM} onClose={() => {}} />);

    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });
});
