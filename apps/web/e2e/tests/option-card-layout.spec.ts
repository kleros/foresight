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
  "a scale in millions at its top": "unit=%24M&lower=0&upper=5000000&market=3250000&value=5000000",
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

    test("never scrolls sideways while it opens, with the market at the top of a millions scale", async ({ page }) => {
      await page.addInitScript(() => {
        const spills: number[] = [];
        (window as unknown as { spills: number[] }).spills = spills;
        const sample = () => {
          spills.push(document.documentElement.scrollWidth - document.documentElement.clientWidth);
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      await openCard(page, "unit=%24M&lower=0&upper=5000000&market=5000000");
      await page.waitForTimeout(500);

      const spills = await page.evaluate(() => (window as unknown as { spills: number[] }).spills);
      expect(Math.max(...spills), `over ${spills.length} frames`).toBe(0);
    });

    test("shows a position with no bar, its UP and DOWN on one line inside the card", async ({ page }) => {
      for (const query of [CASES["a position nearly all UP"], CASES["a scale in millions"]]) {
        await openCard(page, query);
        const held = page.getByTestId("position-held");
        const [box, card] = await Promise.all([
          held.boundingBox(),
          page.locator("#root > div > div").first().boundingBox(),
        ]);

        await expect(page.getByTestId("position-bar-up")).toHaveCount(0);
        expect(box!.height, query).toBeLessThanOrEqual(20);
        expect(box!.x + box!.width, query).toBeLessThanOrEqual(card!.x + card!.width);
      }
    });

    for (const [held, position] of [
      ["", ""],
      [" with a position", "&up=214.08&down=1.43"],
    ]) {
      test(`keeps one height${held} at rest, above, below, at and near the market`, async ({ page }) => {
        const heights: number[] = [];
        for (const query of ["", "value=87", "value=20", "value=75", "market=85&value=88"]) {
          await openCard(page, query + position);
          heights.push(
            await page
              .locator("#root > div > div")
              .first()
              .evaluate((card) => (card as HTMLElement).offsetHeight),
          );
        }

        expect(new Set(heights).size, heights.join(", ")).toBe(1);
      });
    }

    test("gives Details a row at least 44px tall under a hairline", async ({ page }) => {
      await openCard(page, "");

      const details = page.getByRole("button", { name: "Details" });
      expect((await details.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await details.evaluate((bar) => getComputedStyle(bar).borderTopWidth)).toBe("1px");
    });

    test("rounds the card to the popup's panel radius, its header following it while closed", async ({ page }) => {
      await page.goto(`${harness.url}?`);
      const card = page.locator("#root > div > div").first();
      const header = page.locator("#root button").first();

      await expect(card).toHaveCSS("border-radius", "16px");
      await expect(header).toHaveCSS("border-bottom-left-radius", "16px");
      await header.click();
      await expect(header).toHaveCSS("border-bottom-left-radius", "0px");
    });

    test("reveals what opens by opacity and transform alone", async ({ page }) => {
      await page.goto(`${harness.url}?up=3&down=2`);
      await page.evaluate(() => {
        const started: string[][] = [];
        (window as unknown as { started: string[][] }).started = started;
        document.addEventListener("animationstart", (event) => {
          const animation = (event.target as Element)
            .getAnimations()
            .find((running) => (running as CSSAnimation).animationName === event.animationName)!;
          const keys = (animation.effect as KeyframeEffect).getKeyframes().flatMap((frame) => Object.keys(frame));
          started.push(
            [...new Set(keys)]
              .filter((key) => !["offset", "easing", "composite", "computedOffset"].includes(key))
              .sort(),
          );
        });
      });
      const started = () => page.evaluate(() => (window as unknown as { started: string[][] }).started.splice(0));

      await page.locator("#root button").first().click();
      await expect.poll(started).toEqual([["opacity", "transform"]]);
      await page.getByRole("button", { name: "Details" }).click();
      await expect.poll(started).toEqual([["opacity", "transform"]]);
    });
  });
}
