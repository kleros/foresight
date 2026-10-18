import { expect, test, type Locator, type Page } from "@playwright/test";

import { openHarness, startHarness } from "../utils/component-harness";

/** `?credits=` in e2e/harness/predict-popup/main.tsx. */
const CREDIT_STATES = ["enough", "partial", "off", "short", "empty"] as const;
const NOTES: Record<(typeof CREDIT_STATES)[number], string> = {
  enough: "15 credits available",
  partial: "4 credits available",
  off: "15 credits available",
  short: "200 of your 500 credits usable right now",
  empty: "None usable right now. Add your own sDAI.",
};
const STEPS = ["Create a trade wallet", "Add funds", "Place prediction"];
const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 375, height: 667 },
];

let harness: Awaited<ReturnType<typeof startHarness>>;

test.beforeAll(async () => {
  harness = await startHarness("predict-popup");
});

test.afterAll(async () => {
  await harness?.close();
});

async function openCredits(page: Page, credits: string, theme: string) {
  await openHarness(page, `${harness.url}?options=2&state=idle&credits=${credits}&theme=${theme}`);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Close" })).toBeVisible();
  await dialog.evaluate((element) =>
    Promise.all(
      element
        .getAnimations({ subtree: true })
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  return dialog;
}

/** The boxes the credits line must hold still: the line, the dialog, its button and the steps. */
async function footprint(dialog: Locator) {
  const round = (value: number) => Math.round(value * 10) / 10;
  const box = async (locator: Locator) => {
    const rect = (await locator.boundingBox())!;
    return [rect.x, rect.y, rect.width, rect.height].map(round);
  };
  return {
    line: await box(dialog.getByTestId("credits-line")),
    dialog: await box(dialog),
    footer: await box(dialog.locator(".predict-cta")),
    body: round(await dialog.getByTestId("predict-body").evaluate((element) => element.scrollHeight)),
  };
}

/** True when the element's box sits inside its panel and none of its text is cut. */
function sitsWhole(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const panel = element.closest("[data-panel=amount]")!.getBoundingClientRect();
    const cut = [element, ...element.querySelectorAll("*")].some(
      (child) => child.scrollWidth > child.clientWidth + 1 && getComputedStyle(child).overflow !== "visible",
    );
    return !cut && box.left >= panel.left && box.right <= panel.right && box.bottom <= panel.bottom;
  });
}

for (const viewport of VIEWPORTS) {
  for (const theme of ["light", "dark"]) {
    test.describe(`the credits line at ${viewport.width} x ${viewport.height}, ${theme}`, () => {
      test.use({ viewport });

      test("holds one footprint and fits its words in every state", async ({ page }, testInfo) => {
        const pageErrors: string[] = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));
        const footprints: Record<string, Awaited<ReturnType<typeof footprint>>> = {};

        for (const credits of CREDIT_STATES) {
          const dialog = await openCredits(page, credits, theme);
          const line = dialog.getByTestId("credits-line");
          await line.evaluate((element) => element.scrollIntoView({ block: "nearest" }));
          await expect.soft(line.getByTestId("credits-note")).toHaveText(NOTES[credits]);
          expect.soft(await sitsWhole(line), `${credits}: the line sits whole in the amount panel`).toBe(true);
          // the note is one line at every width, so no state grows the panel
          expect
            .soft(
              await line.getByTestId("credits-note").evaluate((element) => element.getBoundingClientRect().height),
              `${credits}: the note is one line`,
            )
            .toBeLessThanOrEqual(16.5);
          expect
            .soft(
              await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
              `${credits}: no sideways scroll`,
            )
            .toBe(true);

          const tick = dialog.getByRole("checkbox", { name: "Use your Foresight credits" });
          const useMax = dialog.getByRole("button", { name: "Use max" });
          if (credits === "enough" || credits === "partial" || credits === "short") {
            await expect.soft(tick).toBeChecked();
            await expect.soft(useMax).toBeVisible();
          } else {
            await expect.soft(tick).not.toBeChecked();
            await expect.soft(useMax).toBeHidden();
          }
          if (credits === "empty") await expect.soft(tick).toBeDisabled();

          for (const title of STEPS) {
            const step = dialog.getByText(title, { exact: true });
            await step.evaluate((element) => element.scrollIntoView({ block: "nearest" }));
            const barTop = (await dialog.locator(".predict-cta").boundingBox())!.y;
            const box = (await step.boundingBox())!;
            expect
              .soft(box.y + box.height, `${credits}: "${title}" ends above the Predict bar`)
              .toBeLessThanOrEqual(barTop);
          }

          await dialog.evaluate((element) => element.querySelectorAll("*").forEach((child) => child.scrollTo(0, 0)));
          const name = `credits-${viewport.width}x${viewport.height}-${theme}-${credits}.png`;
          const shot = await page.screenshot({ animations: "disabled" });
          await testInfo.attach(name, { body: shot, contentType: "image/png" });
          footprints[credits] = await footprint(dialog);
        }

        for (const credits of CREDIT_STATES) {
          expect.soft(footprints[credits], `${credits} holds the enough state's footprint`).toEqual(footprints.enough);
        }
        expect.soft(pageErrors, "page errors").toEqual([]);
      });

      test("unticking moves nothing and hides Use max; ticking brings it back", async ({ page }) => {
        const dialog = await openCredits(page, "enough", theme);
        const before = await footprint(dialog);
        const tick = dialog.getByRole("checkbox", { name: "Use your Foresight credits" });
        const useMax = dialog.getByRole("button", { name: "Use max" });

        await dialog.getByText("Use your Foresight credits").click();
        await expect(tick).not.toBeChecked();
        await expect(useMax).toBeHidden();
        expect(await footprint(dialog)).toEqual(before);

        await dialog.getByText("Use your Foresight credits").click();
        await expect(tick).toBeChecked();
        await expect(useMax).toBeVisible();
        expect(await footprint(dialog)).toEqual(before);
      });
    });
  }
}
