import { expect, test } from "../fixtures";
import { CreateWizard } from "../utils/create-wizard";
import { childMarketName, duneDraft } from "../utils/drafts";

/**
 * The guards, not the layout. What they let through is covered in
 * create-deploy.spec.ts.
 */

test("a blank draft cannot deploy and says why", async ({ page }) => {
  const wizard = new CreateWizard(page);
  await wizard.open();

  await expect(page.getByText("Deploy is disabled until these resolve.")).toBeVisible();
  await expect(page.getByText("The decision has no question.")).toBeVisible();
  await expect(wizard.deployButton).toBeDisabled();
});

test("a completed draft resolves every step", async ({ page }) => {
  const wizard = new CreateWizard(page);
  await wizard.open();
  await wizard.fill(duneDraft(test.info()));

  await expect(page.getByText("Every step resolves. This session is ready to deploy.")).toBeVisible();
});

test("the unit is composed into the question, never typed as brackets", async ({ page }) => {
  const draft = duneDraft(test.info());
  const wizard = new CreateWizard(page);
  await wizard.open();
  await wizard.fill(draft);

  await expect(page.getByText(childMarketName(draft, draft.outcomes[0]!.label)).first()).toBeVisible();
});

test("a bracket in the decision is rejected, since they are reserved for the unit", async ({ page }) => {
  const wizard = new CreateWizard(page);
  await wizard.open();
  await wizard.fill(duneDraft(test.info()));

  await wizard.setDecision("Opening gross [in $M]?");

  await expect(page.getByText(/contains square brackets/)).toBeVisible();
  await expect(wizard.deployButton).toBeDisabled();
});

test("an upper bound below the lower one is rejected, since the contract does not check it", async ({ page }) => {
  const wizard = new CreateWizard(page);
  await wizard.open();
  await wizard.fill(duneDraft(test.info()));

  // react-aria commits a NumberField on blur, so the guard fires on leaving it.
  await wizard.setBounds("0.5", "0");

  await expect(page.getByRole("heading", { name: "Lower bound is not below the upper bound." })).toBeVisible();
  await expect(wizard.deployButton).toBeDisabled();
});

test("a quote in an outcome is rejected, since the oracle's question is built by substitution", async ({ page }) => {
  const wizard = new CreateWizard(page);
  await wizard.open();
  await wizard.fill(duneDraft(test.info()));

  await wizard.setOutcomeLabel(0, 'Denis "DV" Villeneuve');

  // Twice: the outcome is quoted into the question, and the question is a field.
  await expect(page.getByText(/would break the question Reality.eth asks/).first()).toBeVisible();
  await expect(page.getByText(/would break the question Reality.eth asks/)).toHaveCount(2);
  await expect(wizard.deployButton).toBeDisabled();
});

test("two outcomes with the same name are rejected", async ({ page }) => {
  const wizard = new CreateWizard(page);
  await wizard.open();
  await wizard.fill(duneDraft(test.info()));

  await wizard.setOutcomeLabel(1, "Villeneuve");

  await expect(page.getByText('Two outcomes are both called "Villeneuve".')).toBeVisible();
  await expect(wizard.deployButton).toBeDisabled();
});

test("a unit with a space in it is rejected", async ({ page }) => {
  const wizard = new CreateWizard(page);
  await wizard.open();
  await wizard.fill(duneDraft(test.info()));

  await wizard.setUnit("$ millions");

  await expect(page.getByText("The unit is just the symbol: no brackets, no spaces.")).toBeVisible();
  await expect(wizard.deployButton).toBeDisabled();
});

test("the draft survives a reload, since losing it would strand a phased deploy", async ({ page }) => {
  const draft = duneDraft(test.info());
  const wizard = new CreateWizard(page);
  await wizard.open();
  await wizard.fill(draft);

  await page.reload();

  await expect(page.getByRole("textbox", { name: "Decision" })).toHaveValue(draft.decision);
  await expect(page.getByRole("textbox", { name: "Outcome name" }).nth(0)).toHaveValue(draft.outcomes[0]!.label);
});

test("the images are asked for again after a reload, since only their names survive it", async ({ page }) => {
  const wizard = new CreateWizard(page);
  await wizard.open();
  await wizard.fill(duneDraft(test.info()));
  await expect(page.getByText("Every step resolves. This session is ready to deploy.")).toBeVisible();

  await page.reload();

  // The bytes never survive a reload; the names must not either.
  await expect(page.getByText("No hero image. The card has no artwork.")).toBeVisible();
  await expect(wizard.deployButton).toBeDisabled();
});

test("an outcome that yields no token name is refused before it can cost gas", async ({ page, wallet }) => {
  const wizard = new CreateWizard(page);
  await wizard.open();
  await wizard.fill(duneDraft(test.info(), { outcomes: [{ label: "北京" }, { label: "Ελλάδα" }] }));
  await wallet.connect("alice");
  await wizard.signIn();

  // Seer names each outcome's ERC20 from this and refuses an empty one.
  await expect(page.getByText('"北京" gives no token name. Write one under advanced settings.')).toBeVisible();
  await expect(wizard.deployButton).toBeDisabled();
});

test("a name in another script deploys once its token is written out", async ({ page, wallet }) => {
  const wizard = new CreateWizard(page);
  await wizard.open();
  await wizard.fill(
    duneDraft(test.info(), {
      outcomes: [
        { label: "北京", token: "BEIJING" },
        { label: "Ελλάδα", token: "HELLAS" },
      ],
    }),
  );
  await wallet.connect("alice");
  await wizard.signIn();

  await expect(wizard.deployButton).toBeEnabled();
});
