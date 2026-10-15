import { expect, test, type Page } from "@playwright/test";

import { startHarness } from "../utils/component-harness";

let harness: Awaited<ReturnType<typeof startHarness>>;

test.beforeAll(async () => {
  harness = await startHarness("option-card");
});

test.afterAll(async () => {
  await harness?.close();
});

/** Worst cases the card has to hold: a long name, a scale in millions, and a position all on one side. */
const CASES = {
  "a long name": "name=Movie%20A%2C%20the%20director's%20extended%20cut%20(2026)&value=20&up=3&down=2",
  "a scale in millions": "unit=%24M&lower=0&upper=5000000&market=3250000&value=4100000&up=12345.67&down=890.12",
  "a position nearly all UP": "value=90&up=1000000&down=0.01",
  "a narrow scale": "unit=&lower=0&upper=1&market=0.5&value=0.45",
};

async function openCard(page: Page, query: string) {
  await page.goto(`${harness.url}?${query}`);
  await page.locator("#root button").first().click();
  await expect(page.getByRole("slider")).toBeVisible();
}

for (const width of [320, 375, 1280]) {
  test.describe(`the option card at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    for (const [name, query] of Object.entries(CASES)) {
      test(`holds ${name} without scrolling sideways`, async ({ page }) => {
        await openCard(page, query);

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBe(0);
      });
    }

    test("draws both sides of a position on its bar", async ({ page }) => {
      await openCard(page, CASES["a position nearly all UP"]);

      for (const side of ["up", "down"]) {
        const box = (await page.getByTestId(`position-bar-${side}`).boundingBox())!;
        expect(box.width, `${side} segment`).toBeGreaterThanOrEqual(2);
      }
    });

    test("keeps one height at rest, above, below and near the market", async ({ page }) => {
      const heights: number[] = [];
      for (const query of ["", "value=87", "value=20", "market=85&value=88"]) {
        await openCard(page, query);
        heights.push(
          await page
            .locator("#root > div > div")
            .first()
            .evaluate((card) => (card as HTMLElement).offsetHeight),
        );
      }

      expect(new Set(heights).size, heights.join(", ")).toBe(1);
    });

    test("gives Details a bordered bar at least 44px tall", async ({ page }) => {
      await openCard(page, "");

      const details = page.getByRole("button", { name: "Details" });
      expect((await details.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await details.evaluate((bar) => getComputedStyle(bar).borderTopWidth)).toBe("1px");
    });
  });
}
