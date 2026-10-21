import { expect, test, type Locator, type Page } from "@playwright/test";

import { openHarness, startHarness } from "../utils/component-harness";

/** `?credits=` in e2e/harness/predict-popup/main.tsx. */
const CREDIT_STATES = ["enough", "partial", "short", "long", "empty", "whale"] as const;
/** The states with nothing usable, which offer no tick. */
const NONE_USABLE: readonly string[] = ["empty", "whale"];
const NOTES: Record<(typeof CREDIT_STATES)[number], string> = {
  enough: "15 credits available",
  partial: "4 credits available",
  short: "20 of 50 usable now",
  long: "81.7347 of 2,000 usable now",
  empty: "None usable now. Use your own funds.",
  whale: "None usable now. Use your own funds.",
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
        // the cue's nudge ends where it starts, and waiting it out would end it
        .filter((animation) => (animation as CSSAnimation).animationName !== "fsNudgeDown")
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
    footer: await box(dialog.locator(".predict-footer > .predict-cta")),
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
              await line.getByTestId("credits-note").evaluate((element) => element.scrollWidth <= element.clientWidth),
              `${credits}: the note is not cut`,
            )
            .toBe(true);
          expect
            .soft(
              await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
              `${credits}: no sideways scroll`,
            )
            .toBe(true);

          // the tick starts on wherever credits are usable, and Predict stays free
          const tick = dialog.getByRole("checkbox", { name: TICK });
          await expect.soft(tick).toHaveCount(NONE_USABLE.includes(credits) ? 0 : 1);
          if (!NONE_USABLE.includes(credits)) await expect.soft(tick).toBeChecked();
          const max = dialog.getByRole("button", { name: "Max credits" });
          if (NONE_USABLE.includes(credits)) await expect.soft(max).toBeHidden();
          else await expect.soft(max).toBeVisible();
          await expect.soft(dialog.getByRole("status")).toBeEmpty();
          await expect.soft(dialog.getByRole("button", { name: "Predict", exact: true })).toBeEnabled();

          for (const title of STEPS) {
            const step = dialog.getByText(title, { exact: true });
            await step.evaluate((element) => element.scrollIntoView({ block: "nearest" }));
            const barTop = (await dialog.locator(".predict-footer > .predict-cta").boundingBox())!.y;
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
        // at 320 x 568 the tick's target opens 7px past the fold; the scroll a press makes is the next test's
        await dialog.getByTestId("credits-line").evaluate((element) => element.scrollIntoView({ block: "nearest" }));
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

      test("scrolls the body on a first tick press no further than brings the line whole into view", async ({
        page,
      }, testInfo) => {
        const dialog = await openCredits(page, "enough", theme);
        // the line's nearest scrolling ancestor, and how far the tick's target runs past its visible foot
        const read = () =>
          tickLabel(dialog).evaluate((label) => {
            let box = label.parentElement!;
            while (!["auto", "scroll"].includes(getComputedStyle(box).overflowY)) box = box.parentElement!;
            const below = label.getBoundingClientRect().bottom - box.getBoundingClientRect().bottom;
            return { scrolled: box.scrollTop, below: Math.max(0, below) };
          });
        const before = await read();
        testInfo.annotations.push({ type: "below the fold at open", description: `${before.below}px` });
        await tickLabel(dialog).click();
        const after = await read();
        expect(after.below).toBe(0);
        expect(after.scrolled - before.scrolled).toBeLessThanOrEqual(Math.ceil(before.below));
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

for (const viewport of VIEWPORTS) {
  test.describe(`a large credits swap loss at ${viewport.width} x ${viewport.height}`, () => {
    test.use({ viewport });

    test("is said whole on one small line of the status line", async ({ page }) => {
      await openHarness(page, `${harness.url}?options=2&credits=enough&swapLoss=0.5&theme=light`);
      const line = page.getByRole("dialog").getByRole("status").locator("span");

      await expect(line).toHaveText("Credits swap loses ≈ 0.5 xDAI.");
      const [lines, height, lineHeight, fontSize, fits] = await line.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return [
          new Set([...range.getClientRects()].map((box) => Math.round(box.top))).size,
          element.getBoundingClientRect().height,
          parseFloat(getComputedStyle(element).lineHeight),
          parseFloat(getComputedStyle(element).fontSize),
          element.scrollWidth <= element.clientWidth,
        ];
      });
      expect(lines).toBe(1);
      // layout heights carry sub-pixel error, so the box is compared to the computed line-height in whole pixels
      expect(Math.round(height)).toBe(Math.round(lineHeight));
      expect(fontSize).toBe(12);
      expect(fits).toBe(true);
    });
  });
}

// the trade wallet holds 6 sDAI and the amount is 10; credits are spent trade wallet first, then the wallet's
const FUNDS_STEP = [
  { credits: "enough", ticked: "10 credits" },
  { credits: "partial", ticked: "3 credits" },
] as const;

for (const { credits, ticked } of FUNDS_STEP) {
  test(`the Add funds step names the ${credits} credits the tick moves, and the sDAI once unticked`, async ({
    page,
  }) => {
    const dialog = await openCredits(page, credits, "light");
    const step = dialog.getByRole("listitem").filter({ hasText: "Add funds" });

    await expect(step).toContainText(ticked);
    await expect(step).not.toContainText("sDAI");

    await tickLabel(dialog).click();
    await expect(step).toContainText("4 sDAI");
    await expect(step).not.toContainText("credits");
  });
}

// the harness's stored run deposits 4 of the pay token and, with credits on, moves 2 from the visitor's wallet
const RECOVERED_FUNDS = [
  { query: "pay=native", adds: "4 xDAI" },
  { query: "pay=native&credits=enough", adds: "2 credits + 4 xDAI" },
  { query: "credits=enough", adds: "2 credits + 4 sDAI" },
  // a stored run keeps the credits it started with after the manager empties
  { query: "credits=empty", adds: "2 credits + 4 sDAI" },
] as const;

for (const { query, adds } of RECOVERED_FUNDS) {
  test(`a stored run's Add funds step names its own deposit, ${query}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await openHarness(page, `${harness.url}?options=2&state=recovered&${query}`);
    const dialog = page.getByRole("dialog");
    const step = dialog.getByRole("listitem").filter({ hasText: "Add funds" });

    await expect(step.getByText(adds, { exact: true })).toBeVisible();
    await expect(dialog.getByLabel("Amount")).toHaveValue("4");
    if (!query.includes("pay=native")) return;
    // 4 xDAI at the harness's 1.0937 xDAI an sDAI
    const note = dialog.getByText("Locked to this prediction's amount; the deposit ≈ 3.6573 sDAI.", { exact: true });
    expect(await lineBoxes(note), "the note's lines at 320px").toBeLessThanOrEqual(2);
  });
}

for (const viewport of [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
]) {
  test(`a stored xDAI run's note holds two lines with a 36,680.1234 sDAI deposit at ${viewport.width} x ${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openHarness(page, `${harness.url}?options=2&state=recovered&pay=native&deposited=36680.1234`);
    const note = page
      .getByRole("dialog")
      .getByText("Locked to this prediction's amount; the deposit ≈ 36,680.1234 sDAI.", { exact: true });

    expect(await lineBoxes(note)).toBeLessThanOrEqual(2);
  });
}

/** The rendered lines of an element's text; its box alone can't tell, as the note reserves two lines. */
async function lineBoxes(element: Locator): Promise<number> {
  return element.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    return new Set([...range.getClientRects()].map((box) => Math.round(box.top))).size;
  });
}
