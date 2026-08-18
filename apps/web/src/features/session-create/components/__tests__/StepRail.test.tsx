import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { railState, StepRail, type RailEntry } from "../StepRail";

const ENTRIES: RailEntry[] = [
  { key: "1", num: "1", label: "Decision market", elementId: "sec1", state: "ok" },
  { key: "2", num: "2", label: "Branch markets", elementId: "sec2", state: "ok" },
  { key: "2.a", num: "", label: "Villeneuve", elementId: "branch-0", sub: true, state: "ok" },
  { key: "2.b", num: "", label: "Gerwig", elementId: "branch-1", sub: true, state: "ok" },
  { key: "3", num: "3", label: "Display metadata", elementId: "sec3", state: "ok" },
];

/** The rail draws its emphasis in inline styles, so full opacity is what "on" looks like. */
const lit = () =>
  screen
    .getAllByRole("button")
    .filter((button) => button.style.opacity === "1")
    .map((button) => button.textContent);

function renderRail(index: number, onReset = vi.fn()) {
  render(
    <StepRail entries={ENTRIES} index={index} onGoTo={vi.fn()} onReset={onReset} issueCount={0} warningCount={0} />,
  );
  return { onReset };
}

describe("The dot a rail entry shows", () => {
  it("is clear when the step resolves and nothing warns", () => {
    expect(railState(true, false)).toBe("ok");
  });

  it("warns when the step resolves but something is worth a look", () => {
    expect(railState(true, true)).toBe("warn");
  });

  it("errors when the step does not resolve", () => {
    expect(railState(false, false)).toBe("error");
  });

  it("errors rather than warns when the step has both", () => {
    expect(railState(false, true)).toBe("error");
  });
});

describe("The entry the rail marks", () => {
  it("is the step alone when a step is active", () => {
    renderRail(0);

    expect(lit()).toEqual(["1Decision market"]);
  });

  it("is the branch and the step it belongs to when a branch is active", () => {
    renderRail(3);

    expect(lit()).toEqual(["2Branch markets", "Gerwig"]);
  });
});

/** The draft is the only copy of what has been typed, so the button asks first. */
describe("The reset button", () => {
  it("clears nothing until the ask is answered", async () => {
    const user = userEvent.setup();
    const { onReset } = renderRail(0);

    await user.click(screen.getByRole("button", { name: "Reset draft" }));

    expect(onReset).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Clear everything" }));

    expect(onReset).toHaveBeenCalledOnce();
  });

  it("goes back to asking nothing when the reset is declined", async () => {
    const user = userEvent.setup();
    const { onReset } = renderRail(0);

    await user.click(screen.getByRole("button", { name: "Reset draft" }));
    await user.click(screen.getByRole("button", { name: "Keep it" }));

    expect(onReset).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Reset draft" })).toBeInTheDocument();
  });
});
