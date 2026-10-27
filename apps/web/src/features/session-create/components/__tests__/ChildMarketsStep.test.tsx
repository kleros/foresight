import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { draftAssessment } from "../../__tests__/support/drafts";
import { useDraftStore } from "../../stores/draftStore";
import { ChildMarketsStep } from "../ChildMarketsStep";

/**
 * The roles `e2e/utils/create-wizard.ts` drives the unit field through.
 *
 * The select's button carries an `aria-labelledby` chain as well as its
 * `aria-label`, so its accessible name ends with the label. Playwright matches a
 * role name as a substring; this suite matches exactly, hence the regex.
 */

const READY = draftAssessment({ branchOk: [true, true], branchWarn: [false, false] });

/** Fixed, so nothing in the suite turns on the real clock. */
const NOW = new Date(2026, 7, 20, 12, 0, 0);

const draft = () => useDraftStore.getState().draft;

function renderStep() {
  return render(<ChildMarketsStep assessment={READY} active activeBranch={0} now={NOW} zone="UTC" />);
}

beforeEach(() => {
  useDraftStore.getState().resetDraft();
});

/** The listbox mounts in a portal, so it is waited for rather than assumed. */
async function openUnits() {
  await userEvent.click(screen.getByRole("button", { name: /Unit/ }));
  return screen.findByRole("listbox");
}

const option = (name: string | RegExp) => screen.findByRole("option", { name });

describe("The unit field", () => {
  it("opens from a control the wizard can find by its label", async () => {
    renderStep();

    await openUnits();

    expect(await option(/^%\s/)).toBeInTheDocument();
  });

  it("puts a listed unit straight on the draft", async () => {
    renderStep();

    await openUnits();
    await userEvent.click(await option(/^%\s/));

    expect(draft().unit).toBe("%");
  });

  it("offers no unit carrying a multiplier, which is the point of the list", async () => {
    renderStep();

    const listbox = await openUnits();

    expect(within(listbox).queryByRole("option", { name: /^\$M/ })).not.toBeInTheDocument();
  });

  it("shows no free-text field while a listed unit is chosen", async () => {
    renderStep();

    await openUnits();
    await userEvent.click(await option(/^%\s/));

    expect(screen.queryByRole("textbox", { name: "Unit" })).not.toBeInTheDocument();
  });

  it("opens a free-text field on Other, and writes what is typed", async () => {
    renderStep();

    await openUnits();
    await userEvent.click(await option("Other..."));
    await userEvent.type(await screen.findByRole("textbox", { name: "Unit" }), "TWh");

    expect(draft().unit).toBe("TWh");
  });

  it("clears the previous unit when Other is chosen, so the old one cannot be deployed unseen", async () => {
    useDraftStore.getState().setDraftField("unit", "%");
    renderStep();

    await openUnits();
    await userEvent.click(await option("Other..."));

    expect(draft().unit).toBe("");
  });

  it("reopens on the free-text field for a draft already holding an unlisted unit", () => {
    useDraftStore.getState().setDraftField("unit", "$M");
    renderStep();

    expect(screen.getByRole("textbox", { name: "Unit" })).toHaveValue("$M");
  });
});

/** The library marks an input in error with this class; `invalid:` and `focus:invalid:` variants are separate tokens. */
const inError = (input: HTMLElement) => input.classList.contains("border-klerosUIComponentsError");

describe("Errors on a blank draft", () => {
  it("leaves an empty template unflagged until the field is left", async () => {
    renderStep();
    const template = screen.getByRole("textbox", { name: "Question template" });
    expect(inError(template)).toBe(false);

    await userEvent.click(template);
    await userEvent.tab();

    expect(inError(template)).toBe(true);
  });

  it("flags a template missing {outcome} as soon as one is typed", async () => {
    renderStep();
    const template = screen.getByRole("textbox", { name: "Question template" });

    await userEvent.type(template, "Revenue");

    expect(inError(template)).toBe(true);
  });

  it("says nothing about the bounds while the upper one is untouched", () => {
    // The blank draft: lower "0", upper "".
    expect(draft().lower).toBe("0");
    expect(draft().upper).toBe("");
    renderStep();

    expect(screen.queryByText("Lower bound is not below the upper bound.")).not.toBeInTheDocument();
  });

  it("flags the bounds once the upper one is left empty", async () => {
    renderStep();

    await userEvent.click(screen.getByRole("textbox", { name: "Upper bound" }));
    await userEvent.tab();

    expect(screen.getByText("Lower bound is not below the upper bound.")).toBeInTheDocument();
  });

  it("leaves an empty free-text unit unflagged until the field is left", async () => {
    renderStep();
    await openUnits();
    await userEvent.click(await option("Other..."));
    const unit = await screen.findByRole("textbox", { name: "Unit" });
    expect(inError(unit)).toBe(false);

    await userEvent.click(unit);
    await userEvent.tab();

    expect(inError(unit)).toBe(true);
  });
});
