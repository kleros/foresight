import { expect, test, type Page } from "@playwright/test";

import { openHarness, startHarness } from "../utils/component-harness";

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
  await openHarness(page, `${harness.url}?${query}`);
  await page.locator("#root button").first().click();
  await expect(page.getByRole("slider")).toBeVisible();
  // the body opens by a transition, so the card's height is read once it has finished
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))),
  );
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

    test("keeps the position's worth and its help inside the card under a long unbroken option name", async ({
      page,
    }) => {
      await openCard(page, "name=Benachrichtigungseinstellungenverwaltung%20(revised%202026)&up=1234567.89&down=0");
      const card = (await page.locator("#root > div > div").first().boundingBox())!;
      const help = page.getByLabel("How this is worked out");
      const worth = page.getByText(/^≈ /);

      for (const part of [help, worth]) {
        const box = (await part.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(card.x);
        expect(box.x + box.width).toBeLessThanOrEqual(card.x + card.width);
      }
      const hit = await help.evaluate((element) => {
        const { left, top, width, height } = element.getBoundingClientRect();
        const found = document.elementFromPoint(left + width / 2, top + height / 2);
        return found !== null && (found === element || element.contains(found));
      });
      expect(hit, "the help icon takes a press").toBe(true);

      const lineHeight = await worth.evaluate((element) => parseFloat(getComputedStyle(element).lineHeight));
      const worthBox = (await worth.boundingBox())!;
      expect(worthBox.height, "the worth on one line").toBeLessThanOrEqual(lineHeight + 1);
      const helpBox = (await help.boundingBox())!;
      expect(
        Math.abs(helpBox.y + helpBox.height / 2 - (worthBox.y + worthBox.height / 2)),
        "the help centred on the worth's line",
      ).toBeLessThanOrEqual(1);
    });

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

    // at 320 "You hold 12,345.67 UP · 890.12 DOWN" is wider than the row's 256px, so DOWN wraps under UP there
    test("shows a position with no bar, its UP and DOWN inside the row, on one line from 375px", async ({ page }) => {
      for (const query of [CASES["a position nearly all UP"], CASES["a scale in millions"]]) {
        await openCard(page, query);
        const held = page.getByTestId("position-held");
        const [box, row] = await Promise.all([
          held.boundingBox(),
          page.getByRole("region", { name: "Your position" }).boundingBox(),
        ]);

        await expect(page.getByTestId("position-bar-up")).toHaveCount(0);
        if (width >= 375) expect(box!.height, query).toBeLessThanOrEqual(20);
        expect(box!.x + box!.width, query).toBeLessThanOrEqual(row!.x + row!.width + 0.5);
      }
    });

    test("keeps an eight-digit UP and a four-digit DOWN inside the position row", async ({ page }) => {
      for (const query of ["value=87&up=1234567.89&down=0.01", "value=87&up=12345678.89&down=1234.56"]) {
        await openCard(page, query);
        const row = page.getByRole("region", { name: "Your position" });
        const edge = (await row.boundingBox())!;
        for (const side of [/ UP$/, / DOWN$/]) {
          const figure = (await page.getByTestId("position-held").getByText(side).boundingBox())!;
          expect(figure.x + figure.width, `${query}: ${side}`).toBeLessThanOrEqual(edge.x + edge.width + 0.5);
        }
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
      await openHarness(page, `${harness.url}?`);
      const card = page.locator("#root > div > div").first();
      const header = page.locator("#root button").first();

      await expect(card).toHaveCSS("border-radius", "16px");
      await expect(header).toHaveCSS("border-bottom-left-radius", "16px");
      await header.click();
      await expect(header).toHaveCSS("border-bottom-left-radius", "0px");
    });

    test("opens the card and its Details by grid rows as the body rises in, each turning one chevron", async ({
      page,
    }) => {
      await openHarness(page, `${harness.url}?up=3&down=2`);
      const motion = () =>
        page.evaluate(() =>
          document
            .getAnimations()
            .map((animation) =>
              animation instanceof CSSTransition
                ? animation.transitionProperty
                : (animation as CSSAnimation).animationName,
            )
            .sort(),
        );
      const chevrons = page.locator('button[aria-expanded] svg path[d="M4 6l4 4 4-4"]');

      await page.locator("#root button").first().click();
      expect(await motion()).toEqual(expect.arrayContaining(["grid-template-rows", "opacity", "rotate", "transform"]));
      await page.getByRole("button", { name: "Details" }).click();
      expect(await motion()).toEqual(expect.arrayContaining(["grid-template-rows", "opacity", "rotate", "transform"]));
      await expect(chevrons).toHaveCount(2);
    });

    test("sets the Details text no larger than its label, with the question under it as a caption", async ({
      page,
    }) => {
      await openCard(page, "");
      await page.getByRole("button", { name: "Details" }).click();
      const size = (text: RegExp) =>
        page.getByText(text).evaluate((element) => parseFloat(getComputedStyle(element).fontSize));

      expect(await size(/^Resolves to the score/)).toBeLessThanOrEqual(await size(/^Details$/));
      expect(await size(/^What percentile score/)).toBe(12);
    });

    // a lavender step on white; on the violet surface the panel tone is too close, so the chip's
    for (const [theme, tone] of [
      ["light", "rgb(244, 242, 251)"],
      ["dark", "rgb(46, 32, 108)"],
    ] as const) {
      test(`tints its header on hover with the popup's hover tone in the ${theme} theme`, async ({ page }) => {
        await openHarness(page, `${harness.url}?theme=${theme}`);
        const header = page.locator("#root button").first();
        await header.hover();

        await expect(header).toHaveCSS("background-color", tone);
      });
    }
  });
}

test.describe("the option card reached by keyboard", () => {
  test.use({ viewport: { width: 375, height: 900 } });

  for (const theme of ["light", "dark"]) {
    test(`rings its header, slider and value pill once each, in the popup's violet, in the ${theme} theme`, async ({
      page,
    }) => {
      await openCard(page, `value=40&theme=${theme}`);
      await page.mouse.move(0, 0);
      const accent = await page.evaluate(() => {
        const probe = document.createElement("span");
        probe.style.color = "var(--fs-popup-accent)";
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      });
      expect(accent).toBe(theme === "light" ? "rgb(107, 60, 245)" : "rgb(155, 123, 255)");

      const seen: string[] = [];
      // the header was pressed to open the card; a key moves the focus on and back to it, by keyboard
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      for (let step = 0; step < 4; step++) {
        if (step > 0) await page.keyboard.press("Tab");
        await page.evaluate(() =>
          Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))),
        );
        const ring = await page.evaluate(() => {
          const element = document.activeElement as HTMLElement;
          const drawn =
            element.getAttribute("type") === "range"
              ? element.closest<HTMLElement>("div:has(>#slider-label)")!
              : element;
          const style = getComputedStyle(drawn);
          const surface = getComputedStyle(element.closest(".fs-aurora")!).backgroundColor;
          const rings = (style.boxShadow.match(/rgb\([^)]*\) 0px 0px 0px [1-9]\d*px/g) ?? []).filter(
            (shadow) => !shadow.startsWith(surface),
          );
          const reach =
            style.outlineStyle === "none" ? 0 : parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth);
          const box = drawn.getBoundingClientRect();
          let clipped = false;
          for (let parent = drawn.parentElement; parent; parent = parent.parentElement) {
            const { overflowX, overflowY } = getComputedStyle(parent);
            if (overflowX === "visible" && overflowY === "visible") continue;
            const clip = parent.getBoundingClientRect();
            clipped ||=
              box.left - reach < clip.left - 0.5 ||
              box.right + reach > clip.right + 0.5 ||
              box.top - reach < clip.top - 0.5 ||
              box.bottom + reach > clip.bottom + 0.5;
          }
          return {
            name: element.getAttribute("aria-label") || element.textContent?.trim() || element.tagName,
            clipped,
            marks: [
              ...(style.outlineStyle === "none" ? [] : [style.outlineColor]),
              ...rings.map((shadow) => shadow.split(" 0px")[0]),
            ],
          };
        });
        seen.push(ring.name);
        expect.soft(ring.marks, `${ring.name}: one ring in the violet`).toEqual([accent]);
        expect.soft(ring.clipped, `${ring.name}: the ring whole`).toBe(false);
      }
      expect(seen.some((name) => name.includes("type your estimate"))).toBe(true);
    });
  }
});
