import { expect, test, type Locator, type Page } from "@playwright/test";

import { startHarness } from "../utils/component-harness";

const STEPS = ["Create a trade wallet", "Add funds to your trade wallet", "Make prediction"];
const SIDE_MARGIN = 16;

let harness: Awaited<ReturnType<typeof startHarness>>;

test.beforeAll(async () => {
  harness = await startHarness("predict-popup");
});

test.afterAll(async () => {
  await harness?.close();
});

/**
 * True when every pixel of `locator` is on screen, inside each scrolling ancestor's
 * box, and not painted over: the browser's hit test at its corners and centre lands on it.
 */
function isFullyShown(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;

    let clip = { top: 0, left: 0, bottom: window.innerHeight, right: window.innerWidth };
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const { overflowX, overflowY } = getComputedStyle(parent);
      if (overflowX === "visible" && overflowY === "visible") continue;
      const box = parent.getBoundingClientRect();
      clip = {
        top: Math.max(clip.top, box.top),
        left: Math.max(clip.left, box.left),
        bottom: Math.min(clip.bottom, box.bottom),
        right: Math.min(clip.right, box.right),
      };
    }
    const EPSILON = 1;
    if (
      rect.top < clip.top - EPSILON ||
      rect.left < clip.left - EPSILON ||
      rect.bottom > clip.bottom + EPSILON ||
      rect.right > clip.right + EPSILON
    ) {
      return false;
    }

    const inset = 2;
    const points: Array<[number, number]> = [
      [rect.left + rect.width / 2, rect.top + rect.height / 2],
      [rect.left + inset, rect.top + inset],
      [rect.right - inset, rect.bottom - inset],
    ];
    return points.every(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return hit !== null && (hit === element || element.contains(hit));
    });
  });
}

async function openPopup(page: Page, options: number) {
  await page.goto(`${harness.url}?options=${options}`);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Predict" })).toBeVisible();
  await expect(dialog.getByText(/than the market/)).toHaveCount(options);
  return dialog;
}

for (const height of [812, 667]) {
  for (const options of [2, 5]) {
    test.describe(`a ${options}-option popup at 375 x ${height}`, () => {
      test.use({ viewport: { width: 375, height } });

      test("keeps side margins, shows every step above the sticky bar and each direction line", async ({
        page,
      }, testInfo) => {
        const pageErrors: string[] = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));

        const dialog = await openPopup(page, options);
        await testInfo.attach(`popup-375x${height}-${options}-options`, {
          body: await page.screenshot(),
          contentType: "image/png",
        });

        const popup = await dialog.boundingBox();
        expect.soft(popup, "the popup has a box").not.toBeNull();
        if (popup) {
          expect.soft(popup.x, "left margin").toBeGreaterThanOrEqual(SIDE_MARGIN);
          expect.soft(375 - (popup.x + popup.width), "right margin").toBeGreaterThanOrEqual(SIDE_MARGIN);
        }

        const barTop = Math.min(
          ...(await Promise.all(
            ["Cancel", "Predict"].map(async (name) => (await dialog.getByRole("button", { name }).boundingBox())!.y),
          )),
        );
        for (const title of STEPS) {
          const step = dialog.getByText(title, { exact: true });
          expect.soft(await isFullyShown(step), `"${title}" is shown`).toBe(true);
          const box = await step.boundingBox();
          expect
            .soft(box && box.y + box.height, `"${title}" ends above the Cancel/Predict bar`)
            .toBeLessThanOrEqual(barTop);
        }

        const directions = dialog.getByText(/than the market/);
        for (let index = 0; index < options; index++) {
          const line = directions.nth(index);
          if (options === 2) {
            expect.soft(await isFullyShown(line), `direction line ${index + 1} is shown without scrolling`).toBe(true);
          } else {
            await line.evaluate((element) => element.scrollIntoView({ block: "nearest" }));
            expect.soft(await isFullyShown(line), `direction line ${index + 1} is shown once scrolled to`).toBe(true);
          }
        }

        expect.soft(pageErrors, "page errors").toEqual([]);

        // A baseline is only ever taken of a layout that passes the checks above; Harman signs it off.
        if (testInfo.errors.length > 0) return;
        await expect(page).toHaveScreenshot(`predict-popup-375x${height}-${options}-options.png`, {
          animations: "disabled",
          caret: "hide",
        });
      });
    });
  }
}
