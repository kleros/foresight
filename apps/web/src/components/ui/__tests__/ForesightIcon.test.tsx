import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ForesightIcon } from "../ForesightIcon";

describe("ForesightIcon", () => {
  it("renders an svg for a known name", () => {
    const { container } = render(<ForesightIcon name="session-tree" />);

    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders nothing for an unknown name", () => {
    // @ts-expect-error a name only reachable at runtime, which is what the guard is for
    const { container } = render(<ForesightIcon name="nope" />);

    expect(container.firstChild).toBeNull();
  });

  it("is decorative, so a screen reader skips it and reads the text beside it", () => {
    const { container } = render(<ForesightIcon name="outcome" />);

    expect(container.querySelector('[role="presentation"]')).toBeInTheDocument();
  });

  it("spins while pending", () => {
    const { container } = render(<ForesightIcon name="pending" state="pending" />);

    expect(container.querySelector("svg")).toHaveClass("fs-icon-pending");
  });

  it("draws itself in while confirming", () => {
    const { container } = render(<ForesightIcon name="outcome" state="drawing" />);

    expect(container.querySelector("svg")).toHaveClass("fs-icon-draw");
  });

  it("rotates the chevron when expanded", () => {
    const { container } = render(<ForesightIcon name="chevron" state="expanded" />);

    expect(container.querySelector("svg")).toHaveStyle({ transform: "rotate(180deg)" });
  });
});
