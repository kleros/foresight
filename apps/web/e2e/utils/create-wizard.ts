import { expect, type Page } from "@playwright/test";

/** The create screen, driven through the fields a creator can see. */

const escapeForRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export type ImageFile = { name: string; mimeType: string; buffer: Buffer };

export type OutcomeSpec = {
  label: string;
  /** Overrides the token name the label would produce. */
  token?: string;
  /** `#rrggbb`; the wizard assigns one per branch until you pick. */
  color?: string;
  /** Markdown for the branch's card. */
  details?: string;
};

export type DraftSpec = {
  decision: string;
  outcomes: OutcomeSpec[];
  /** `MMDDYYYY`, typed into the date field. Trading closes at 12:00 UTC that day. */
  decisionDate: string;
  template: string;
  unit: string;
  lower: string;
  upper: string;
  title: string;
  description: string;
  itemName: string;
  itemNamePlural: string;
  category?: string;
  language?: string;
  minBond?: string;
  multi?: boolean;
  hero: ImageFile;
  icon: ImageFile;
};

/** A branch that differs from the decision it hangs off. */
export type OverrideSpec = {
  question?: string;
  lower?: string;
  upper?: string;
  /** `MMDDYYYY`. Never earlier than the decision's own date. */
  date?: string;
};

export class CreateWizard {
  constructor(private page: Page) {}

  async open() {
    await this.page.goto("/create");
    await this.page.evaluate(() => localStorage.clear());
    await this.page.reload();
  }

  // --- step 1: the decision market ----------------------------------------

  async setDecision(question: string) {
    await this.page.getByRole("textbox", { name: "Decision" }).fill(question);
  }

  /** Adds rows until there are `count` of them. The wizard starts with two. */
  async setOutcomeCount(count: number) {
    const rows = this.page.getByRole("textbox", { name: "Outcome name" });
    for (let existing = await rows.count(); existing < count; existing++) {
      await this.page.getByRole("button", { name: "Add outcome" }).click();
    }
  }

  async setOutcomeLabel(index: number, label: string) {
    await this.page.getByRole("textbox", { name: "Outcome name" }).nth(index).fill(label);
  }

  /** Moves a branch one place, the way the grip's arrow keys do. */
  async moveOutcome(label: string, direction: "up" | "down") {
    const grip = this.page.getByRole("button", { name: new RegExp(`^Reorder ${label},`) });
    await grip.focus();
    await this.page.keyboard.press(direction === "up" ? "ArrowUp" : "ArrowDown");
  }

  async removeOutcome(label: string) {
    const rows = this.page.getByRole("textbox", { name: "Outcome name" });
    const index = (await rows.allInnerTexts()).length;
    for (let position = 0; position < index; position++) {
      if ((await rows.nth(position).inputValue()) === label) {
        return this.page.getByRole("button", { name: "Remove outcome" }).nth(position).click();
      }
    }
    throw new Error(`No outcome called ${label} to remove.`);
  }

  /** @param date `MMDDYYYY` */
  async setDecisionDate(date: string) {
    await this.page.getByRole("spinbutton", { name: /month, Decision date/ }).click();
    await this.page.keyboard.type(date);
  }

  async openDecisionAdvanced() {
    await this.page.locator("#sec1").getByRole("button", { name: "Advanced settings" }).click();
  }

  async setCategory(category: string) {
    await this.page.getByRole("button", { name: "Category" }).click();
    await this.page.getByRole("option", { name: category, exact: true }).click();
  }

  async setLanguage(language: string) {
    await this.page.getByRole("button", { name: "Language" }).click();
    await this.page.getByRole("option", { name: language, exact: true }).click();
  }

  async setMinBond(amount: string) {
    await this.page.getByRole("textbox", { name: "Min bond" }).fill(amount);
  }

  async setMultiCategorical(on: boolean) {
    const toggle = this.page.getByRole("switch", { name: "Multi-categorical" });
    if ((await toggle.isChecked()) === on) return;
    // The switch's input is visually hidden inside its label, which is what
    // takes the click.
    await this.page.locator('label:has(input[aria-label="Multi-categorical"])').click();
    await expect(toggle).toBeChecked({ checked: on });
  }

  async setToken(outcomeLabel: string, token: string) {
    await this.page.getByRole("textbox", { name: `Token name for ${outcomeLabel}` }).fill(token);
  }

  // --- step 2: the branch markets -----------------------------------------

  async setTemplate(template: string) {
    await this.page.getByRole("textbox", { name: "Question template" }).fill(template);
  }

  /** Picks a listed unit, or drops to the free-text field for anything else. */
  async setUnit(unit: string) {
    await this.page.locator("#sec2").getByRole("button", { name: "Unit" }).click();
    // A unit whose name is its symbol is listed once, so the description is optional.
    const listed = this.page.getByRole("option", { name: new RegExp(`^${escapeForRegExp(unit)}(\\s|$)`) });

    if ((await listed.count()) > 0) {
      return listed.first().click();
    }
    await this.page.getByRole("option", { name: "Other...", exact: true }).click();
    await this.page.getByRole("textbox", { name: "Unit" }).fill(unit);
  }

  /** The bounds are a NumberField: it commits on blur, so each is tabbed out of. */
  async setBounds(lower: string, upper: string) {
    await this.page.getByRole("textbox", { name: "Lower bound", exact: true }).fill(lower);
    await this.page.keyboard.press("Tab");
    await this.page.getByRole("textbox", { name: "Upper bound", exact: true }).fill(upper);
    await this.page.keyboard.press("Tab");
  }

  /**
   * Takes a branch off the decision's settings and gives it its own.
   * @param index the branch's place in the outcome list.
   */
  async overrideBranch(index: number, label: string, override: OverrideSpec) {
    // The branch's own card holds the editor: open it, then take the branch off
    // the decision's settings.
    const card = this.page.locator(`#branch-${index}`);
    await card.getByRole("button", { name: `Edit ${label}` }).click();
    await card.getByRole("button", { name: "Override", exact: true }).click();

    if (override.question !== undefined) {
      await this.page.getByRole("textbox", { name: `Question for ${label}` }).fill(override.question);
    }
    if (override.lower !== undefined) {
      await this.page.getByRole("textbox", { name: `Lower bound for ${label}` }).fill(override.lower);
      await this.page.keyboard.press("Tab");
    }
    if (override.upper !== undefined) {
      await this.page.getByRole("textbox", { name: `Upper bound for ${label}` }).fill(override.upper);
      await this.page.keyboard.press("Tab");
    }
    if (override.date !== undefined) {
      await this.page.getByRole("spinbutton", { name: new RegExp(`month, Metric date for ${label}`) }).click();
      await this.page.keyboard.type(override.date);
    }
    await card.getByRole("button", { name: `Done ${label}` }).click();
  }

  // --- step 3: the display metadata ---------------------------------------

  async setTitle(title: string) {
    await this.page.getByRole("textbox", { name: "Session title" }).fill(title);
  }

  async setDescription(description: string) {
    await this.page.getByRole("textbox", { name: "Session description" }).fill(description);
  }

  async setItemNames(singular: string, plural: string) {
    await this.page.getByRole("textbox", { name: "Item name, singular" }).fill(singular);
    await this.page.getByRole("textbox", { name: "Item name, plural" }).fill(plural);
  }

  async setBranchColor(label: string, color: string) {
    await this.page.getByRole("textbox", { name: `Hex colour for ${label}` }).fill(color);
  }

  async setBranchDetails(label: string, markdown: string) {
    await this.page.getByRole("textbox", { name: `Details for ${label}` }).fill(markdown);
  }

  /** Creator mark first, hero second, in screen order. */
  async pickImages(images: { icon: ImageFile; hero: ImageFile }) {
    const pickers = this.page.locator("#sec3 input[type='file']");
    await pickers.nth(0).setInputFiles(images.icon);
    await pickers.nth(1).setInputFiles(images.hero);
  }

  // --- the whole thing ----------------------------------------------------

  /** Fills every field the wizard needs, leaving a draft that is ready to deploy. */
  async fill(spec: DraftSpec) {
    await this.setDecision(spec.decision);
    await this.setOutcomeCount(spec.outcomes.length);
    for (const [index, outcome] of spec.outcomes.entries()) {
      await this.setOutcomeLabel(index, outcome.label);
    }
    await this.setDecisionDate(spec.decisionDate);

    const advanced =
      spec.category !== undefined ||
      spec.language !== undefined ||
      spec.minBond !== undefined ||
      spec.multi !== undefined ||
      spec.outcomes.some((outcome) => outcome.token !== undefined);

    if (advanced) {
      await this.openDecisionAdvanced();
      if (spec.category !== undefined) await this.setCategory(spec.category);
      if (spec.language !== undefined) await this.setLanguage(spec.language);
      if (spec.minBond !== undefined) await this.setMinBond(spec.minBond);
      if (spec.multi !== undefined) await this.setMultiCategorical(spec.multi);
      for (const outcome of spec.outcomes) {
        if (outcome.token !== undefined) await this.setToken(outcome.label, outcome.token);
      }
    }

    await this.setTemplate(spec.template);
    await this.setUnit(spec.unit);
    await this.setBounds(spec.lower, spec.upper);

    await this.setTitle(spec.title);
    await this.setDescription(spec.description);
    await this.setItemNames(spec.itemName, spec.itemNamePlural);
    for (const outcome of spec.outcomes) {
      if (outcome.color !== undefined) await this.setBranchColor(outcome.label, outcome.color);
      if (outcome.details !== undefined) await this.setBranchDetails(outcome.label, outcome.details);
    }
    await this.pickImages({ icon: spec.icon, hero: spec.hero });
  }

  // --- step 5: deploy ------------------------------------------------------

  get signInButton() {
    return this.page.getByRole("button", { name: "Sign in", exact: true });
  }

  get deployButton() {
    return this.page.getByRole("button", { name: "Deploy", exact: true });
  }

  get resumeButton() {
    return this.page.getByRole("button", { name: "Continue this deploy" });
  }

  get retryButton() {
    return this.page.getByRole("button", { name: "Try again" });
  }

  /** Waits for the session, not just the click: the deploy button is disabled until it lands. */
  async signIn() {
    await this.signInButton.click();
    await expect(this.page.getByText("Sign in to continue.")).toHaveCount(0, { timeout: 30_000 });
  }

  async signInAndDeploy() {
    await this.signIn();
    await this.deployButton.click();
  }
}
