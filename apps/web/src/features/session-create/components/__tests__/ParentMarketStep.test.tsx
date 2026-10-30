import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { draftAssessment } from "../../__tests__/support/drafts";
import { useDraftStore } from "../../stores/draftStore";
import { ParentMarketStep } from "../ParentMarketStep";

/** Fixed, so nothing in the suite turns on the real clock. */
const NOW = new Date(2026, 7, 20, 12, 0, 0);

const renderStep = () => render(<ParentMarketStep assessment={draftAssessment()} active now={NOW} zone="UTC" />);

/** The row around each outcome name field, which carries the error border. */
const rows = () =>
  screen.getAllByRole("textbox", { name: "Outcome name" }).map((input) => input.closest(".fs-echo") as HTMLElement);
const flagged = (row: HTMLElement) => row.classList.contains("border-fs-tone-error");

beforeEach(() => {
  localStorage.clear();
  useDraftStore.getState().resetDraft();
});

describe("Outcome rows on a blank draft", () => {
  it("leaves both empty outcomes unflagged on first render", () => {
    renderStep();

    expect(rows().map(flagged)).toEqual([false, false]);
  });

  it("flags only the empty outcome that was left", async () => {
    renderStep();

    await userEvent.click(screen.getAllByRole("textbox", { name: "Outcome name" })[0]!);
    await userEvent.tab();

    expect(rows().map(flagged)).toEqual([true, false]);
  });

  it("flags a duplicate name without either field being left", async () => {
    renderStep();
    const [first, second] = screen.getAllByRole("textbox", { name: "Outcome name" });

    await userEvent.type(first!, "Lisbon");
    await userEvent.type(second!, "Lisbon");

    expect(rows().map(flagged)).toEqual([true, true]);
  });
});

describe("The decision date field", () => {
  it("is labelled as when resolution opens", () => {
    renderStep();

    expect(screen.getByText("Resolution opens (UTC)")).toBeInTheDocument();
  });
});
