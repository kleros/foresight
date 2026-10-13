import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Dialog } from "../Dialog";

const renderDialog = (onClose = vi.fn()) => {
  render(
    <Dialog isOpen onClose={onClose} title="Deposit" hint="From your account">
      <p>body</p>
    </Dialog>,
  );
  return onClose;
};

describe("Dialog", () => {
  it("shows the title, hint and body", () => {
    renderDialog();

    expect(screen.getByRole("heading", { name: "Deposit" })).toBeInTheDocument();
    expect(screen.getByText("From your account")).toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
  });

  it("closes from the corner button", async () => {
    const onClose = renderDialog();

    await userEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when dismissed with Escape", async () => {
    const onClose = renderDialog();

    await userEvent.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("Dialog's accessible name", () => {
  it("is its title", () => {
    renderDialog();

    expect(screen.getByRole("dialog", { name: "Deposit" })).toBeInTheDocument();
  });
});
