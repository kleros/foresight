import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Markdown } from "../Markdown";

describe("Markdown", () => {
  it("renders emphasis and lists", () => {
    const { container } = render(<Markdown>{"Some **bold** text\n\n- one\n- two"}</Markdown>);

    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("keeps a single newline as a line break, the way the textarea showed it", () => {
    const { container } = render(<Markdown>{"one\ntwo"}</Markdown>);

    expect(container.querySelector("br")).not.toBeNull();
  });

  it("treats a literal \\n sequence, pasted from a JSON-escaped source, as the newline it stood for", () => {
    const { container } = render(<Markdown>{"**Pax:** 50\\n**Location:** The Game Palacio"}</Markdown>);

    expect(container.textContent).not.toContain("\\n");
    expect(container.querySelector("br")).not.toBeNull();
  });

  it("opens an https link in a new tab without an opener", () => {
    render(<Markdown>{"[site](https://example.com)"}</Markdown>);

    const link = screen.getByRole("link", { name: "site" });
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it.each([
    ["a script scheme", "javascript:alert(1)"],
    ["plain http", "http://example.com"],
    ["a scheme-relative host", "//example.com"],
    ["a data url", "data:text/html,x"],
  ])("disarms %s, leaving the link text without a link", (_what, url) => {
    const { container } = render(<Markdown>{`[click](${url})`}</Markdown>);

    expect(container.querySelector("a")).toBeNull();
    expect(screen.getByText("click")).toBeInTheDocument();
  });

  it("reduces an image to its alt text, so nothing remote is ever fetched", () => {
    const { container } = render(<Markdown>{"before ![a chart](https://example.com/x.png) after"}</Markdown>);

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("a chart")).toBeInTheDocument();
  });

  it("never renders raw HTML", () => {
    const { container } = render(<Markdown>{'<script>window.x = 1</script><b onmouseover="x()">bold?</b>'}</Markdown>);

    expect(container.querySelector("script, b")).toBeNull();
  });
});
