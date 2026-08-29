import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { MarkdownField } from "../MarkdownField";

describe("MarkdownField", () => {
  it("starts on the textarea, with the toggle offering the preview", () => {
    render(<MarkdownField value="Some words" onChange={() => {}} ariaLabel="Details for Movie A" />);

    expect(screen.getByRole("textbox", { name: "Details for Movie A" })).toHaveValue("Some words");
    expect(screen.getByRole("button", { name: "Preview Details for Movie A" })).toBeInTheDocument();
  });

  it("flips to the rendered markdown and back", async () => {
    render(<MarkdownField value="Some **bold** words" onChange={() => {}} ariaLabel="Details for Movie A" />);

    await userEvent.click(screen.getByRole("button", { name: "Preview Details for Movie A" }));

    expect((await screen.findByText("bold")).tagName).toBe("STRONG");
    expect(screen.queryByRole("textbox", { name: "Details for Movie A" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Edit Details for Movie A" }));

    expect(screen.getByRole("textbox", { name: "Details for Movie A" })).toBeInTheDocument();
  });

  it("stores a pasted literal \\n as a real newline", async () => {
    let latest = "";
    render(<MarkdownField value="" onChange={(v) => (latest = v)} ariaLabel="Details for Movie A" />);

    await userEvent.click(screen.getByRole("textbox", { name: "Details for Movie A" }));
    await userEvent.paste("Pax: 50\\nLocation: The Game Palacio");

    expect(latest).toBe("Pax: 50\nLocation: The Game Palacio");
  });

  it("previews nothing as exactly that", async () => {
    render(<MarkdownField value="   " onChange={() => {}} ariaLabel="Details for Movie A" />);

    await userEvent.click(screen.getByRole("button", { name: "Preview Details for Movie A" }));

    expect(screen.getByText("Nothing to preview yet.")).toBeInTheDocument();
  });
});
