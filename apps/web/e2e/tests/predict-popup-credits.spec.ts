import { expect, test, type Locator, type Page } from "@playwright/test";

import { openHarness, startHarness } from "../utils/component-harness";

/** `?credits=` in e2e/harness/predict-popup/main.tsx. */
const CREDIT_STATES = ["enough", "partial", "short", "long", "empty"] as const;
const NOTES: Record<(typeof CREDIT_STATES)[number], string> = {
  enough: "15 credits available",
  partial: "4 credits available",
  short: "20 of 50 usable now",
  long: "81.7347 of 2,000 usable now",
  empty: "None of your 120 usable now",
};
const TICK = "Use Foresight credits";
const STEPS = ["Create a trade wallet", "Add funds", "Place prediction"];
const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 375, height: 667 },
  { width: 320, height: 568 },
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

/** The boxes the credits line must hold still: the line, the dialog, its button and the body's height. */
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

/** The tick's label, the visitor's target; its words change with the panel's width. */
function tickLabel(dialog: Locator): Locator {
  return dialog.locator("label").filter({ has: dialog.page().getByRole("checkbox", { name: TICK }) });
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

          // the tick starts on wherever credits are usable, and Predict stays free
          const tick = dialog.getByRole("checkbox", { name: TICK });
          await expect.soft(tick).toHaveCount(credits === "empty" ? 0 : 1);
          if (credits !== "empty") await expect.soft(tick).toBeChecked();
          const max = dialog.getByRole("button", { name: "Max credits" });
          if (credits === "empty") await expect.soft(max).toBeHidden();
          else await expect.soft(max).toBeVisible();
          await expect.soft(dialog.getByRole("status")).toBeEmpty();
          await expect.soft(dialog.getByRole("button", { name: "Predict", exact: true })).toBeEnabled();

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

      test("starts ticked with Max credits and Predict free; unticking and ticking move nothing", async ({
        page,
      }, testInfo) => {
        const dialog = await openCredits(page, "enough", theme);
        const before = await footprint(dialog);
        const tick = dialog.getByRole("checkbox", { name: TICK });
        const useMax = dialog.getByRole("button", { name: "Max credits" });
        const predict = dialog.getByRole("button", { name: "Predict", exact: true });
        const status = dialog.getByRole("status");

        await expect(tick).toBeChecked();
        await expect(useMax).toBeVisible();
        await expect(status).toBeEmpty();
        await expect(predict).toBeEnabled();
        await expect(dialog.getByText("≈ 10 sDAI from your credits")).toBeVisible();
        await testInfo.attach(`credits-${viewport.width}x${viewport.height}-${theme}-ticked.png`, {
          body: await page.screenshot({ animations: "disabled" }),
          contentType: "image/png",
        });

        await tickLabel(dialog).click();
        await expect(tick).not.toBeChecked();
        await expect(useMax).toBeHidden();
        await expect(status).toBeEmpty();
        await expect(predict).toBeEnabled();
        expect(await footprint(dialog)).toEqual(before);

        await tickLabel(dialog).click();
        await expect(tick).toBeChecked();
        expect(await footprint(dialog)).toEqual(before);
      });

      test("the tick's target is 44px tall on its 20px row", async ({ page }) => {
        const dialog = await openCredits(page, "enough", theme);
        const label = tickLabel(dialog);
        const row = (await label.evaluate((element) => element.parentElement!.getBoundingClientRect().height))!;
        expect((await label.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        expect(row).toBe(20);
      });
    });
  }
}
