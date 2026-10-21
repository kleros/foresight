import { expect, test, type Page } from "@playwright/test";

import { openHarness, startHarness } from "../utils/component-harness";

let harness: Awaited<ReturnType<typeof startHarness>>;

test.beforeAll(async () => {
  harness = await startHarness("predict-card");
});

test.afterAll(async () => {
  await harness?.close();
});

async function openCard(page: Page, query: string) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openHarness(page, `${harness.url}?${query}`);
  await expect(page.getByRole("heading", { name: "Place your estimates" })).toBeVisible();
}

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const theme of ["light", "dark"]) {
  test.describe(`the Predict card on a wide screen, ${theme}`, () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test("lists three picks and a count of the rest beside its button, with no phone bar", async ({ page }) => {
      await openCard(page, `set=worst&theme=${theme}`);
      const list = page.getByRole("list", { name: "Your estimates" });
      const shown = list.locator("li:visible");
      await expect(shown).toHaveText([/^Greater Lisb.*1,234,567$/, "Berlin360", "Nairobi320", "+3"]);
      await expect(page.getByRole("button", { name: "Predict 6 estimates" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Predict", exact: true })).toBeHidden();
      expect(await sideways(page)).toBe(0);

      // the chips and the button share one row, the button last
      const button = (await page.getByRole("button", { name: "Predict 6 estimates" }).boundingBox())!;
      const chips = (await list.boundingBox())!;
      expect(chips.x + chips.width).toBeLessThanOrEqual(button.x);
      expect(Math.abs(chips.y + chips.height / 2 - (button.y + button.height / 2))).toBeLessThan(2);
      expect(button.height).toBe(44);
    });

    test("keeps a long name to its chip and every value whole", async ({ page }) => {
      await openCard(page, `set=worst&theme=${theme}`);
      const chips = page.getByRole("list", { name: "Your estimates" }).locator("li:visible");
      for (const chip of await chips.all()) {
        const box = (await chip.boundingBox())!;
        expect(box.width).toBeLessThanOrEqual(200);
        expect(box.height).toBe(28);
        const value = chip.locator("span").last();
        if ((await value.count()) === 0) continue;
        expect(await value.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      }
      const name = chips.first().locator("span").first();
      expect(await name.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
      await expect(name).toHaveAttribute("title", "Greater Lisbon and Setúbal Peninsula metropolitan area");
    });

    test("offers a disabled Predict and no chips while nothing is picked", async ({ page }) => {
      await openCard(page, `set=none&theme=${theme}`);
      await expect(page.getByRole("list", { name: "Your estimates" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Predict estimates" })).toBeDisabled();
    });
  });

  for (const viewport of [
    { width: 375, height: 812 },
    { width: 320, height: 568 },
  ]) {
    test.describe(`the Predict card at ${viewport.width} x ${viewport.height}, ${theme}`, () => {
      test.use({ viewport });

      test("puts Predict in a bar under the header that stays there as the page scrolls", async ({ page }) => {
        await openCard(page, `set=worst&theme=${theme}`);
        const predict = page.getByRole("button", { name: "Predict", exact: true });
        await expect(predict).toBeVisible();
        await expect(page.getByRole("button", { name: "Predict 6 estimates" })).toBeHidden();
        const bar = page.getByText(/^6 estimates · /);
        const at = async () => await bar.evaluate((element) => element.parentElement!.getBoundingClientRect().top);
        // under the header: 64px and its 1px rule
        expect(await at()).toBe(65);
        expect((await predict.boundingBox())!.height).toBe(44);

        await page.evaluate(() => window.scrollTo(0, 500));
        await expect.poll(at).toBe(65);
        await expect(predict).toBeInViewport();

        // the bar runs edge to edge, and its words give way to the button
        const box = await bar.evaluate((element) => element.parentElement!.getBoundingClientRect().toJSON());
        expect(box.left).toBe(0);
        expect(box.width).toBe(viewport.width);
        expect(await bar.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
        expect(await sideways(page)).toBe(0);
      });

      test("lists two picks and a count of the rest on the card", async ({ page }) => {
        await openCard(page, `set=worst&theme=${theme}`);
        const list = page.getByRole("list", { name: "Your estimates" });
        const shown = list.locator("li:visible");
        await expect(shown).toHaveText([/^Greater Lisb.*1,234,567$/, "Berlin360", "+4"]);
        const row = (await list.boundingBox())!;
        for (const chip of await shown.all()) {
          const box = (await chip.boundingBox())!;
          expect(box.x + box.width).toBeLessThanOrEqual(row.x + row.width);
        }
        // a long name alone on its row has the row's width, not a fixed cap
        const first = (await shown.first().boundingBox())!;
        expect(first.width).toBeGreaterThan(Math.min(200, row.width - 40));
        expect(await sideways(page)).toBe(0);
      });

      test("leaves the content under the bar where it is as the first pick lands and the last one goes", async ({
        page,
      }) => {
        await openCard(page, `set=none&theme=${theme}`);
        const card = page.getByTestId("option-card").nth(1);
        const top = async () => (await card.boundingBox())!.y;
        for (const scrolled of [0, 300]) {
          // where the engine does not anchor scrolling, only the layout keeps the card in place
          await page.evaluate((y) => {
            document.documentElement.style.overflowAnchor = "none";
            window.scrollTo(0, y);
          }, scrolled);
          const before = await top();
          await page.evaluate(() => (window as unknown as { pickFirst: () => void }).pickFirst());
          await expect(page.getByRole("button", { name: "Predict", exact: true })).toBeVisible();
          expect(await top()).toBe(before);
          await page.evaluate(() => (window as unknown as { clearPicks: () => void }).clearPicks());
          await expect(page.getByRole("button", { name: "Predict", exact: true })).toHaveCount(0);
          expect(await top()).toBe(before);
        }
      });

      test("lets the bar leave as it came, rather than vanish", async ({ page }) => {
        await openCard(page, `set=normal&theme=${theme}`);
        await expect(page.getByRole("button", { name: "Predict", exact: true })).toBeVisible();
        const leaving = await page.evaluate(async () => {
          (window as unknown as { clearPicks: () => void }).clearPicks();
          await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
          return document.querySelector("[data-predict-bar]")?.getAttribute("data-leaving") ?? null;
        });
        expect(leaving).toBe("");
        await expect(page.locator("[data-predict-bar]")).toHaveCount(0);
      });

      for (const query of ["wallet=0", "status=closed"]) {
        test(`draws no bar while Predict is off (${query}), and the card says why`, async ({ page }) => {
          await openCard(page, `set=worst&theme=${theme}&${query}`);
          await expect(page.getByRole("button", { name: "Predict 6 estimates" })).toBeVisible();
          await expect(page.getByRole("button", { name: "Predict 6 estimates" })).toBeDisabled();
          await expect(page.getByRole("button", { name: "Predict", exact: true })).toHaveCount(0);
          await expect(page.getByText(/^(Connect a wallet to predict\.|Trading has closed\.)$/)).toBeVisible();
        });
      }

      test("names three picks in the bar as two and a count", async ({ page }) => {
        await openCard(page, `set=normal&theme=${theme}`);
        await expect(page.getByText("3 estimates · Berlin, Lisbon +1")).toBeVisible();
      });

      test("draws no bar, and keeps the card's own Predict, while nothing is picked", async ({ page }) => {
        await openCard(page, `set=none&theme=${theme}`);
        await expect(page.getByRole("button", { name: "Predict", exact: true })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Predict estimates" })).toBeVisible();
      });
    });
  }
}

for (const theme of ["light", "dark"]) {
  for (const viewport of [
    { width: 568, height: 320 },
    { width: 844, height: 390 },
  ]) {
    test.describe(`the Predict card on a phone on its side, ${viewport.width} x ${viewport.height}, ${theme}`, () => {
      test.use({ viewport });

      test("pins no bar over the options and keeps Predict on the card", async ({ page }) => {
        await openCard(page, `set=worst&theme=${theme}`);
        await expect(page.getByRole("button", { name: "Predict", exact: true })).toBeHidden();
        const predict = page.getByRole("button", { name: "Predict 6 estimates" });
        await predict.scrollIntoViewIfNeeded();
        await expect(predict).toBeVisible();
        await expect(predict).toBeInViewport();
      });
    });
  }

  test.describe(`the Predict card between 641 and 767px, ${theme}`, () => {
    test.use({ viewport: { width: 700, height: 1000 } });

    test("lines the bar's words up with the page's gutter", async ({ page }) => {
      await openCard(page, `set=normal&theme=${theme}`);
      const words = page.getByText(/^3 estimates · /);
      const heading = page.getByRole("heading", { name: "City populations" });
      expect((await words.boundingBox())!.x).toBe((await heading.boundingBox())!.x);
    });
  });

  test.describe(`the Predict card at 768 x 1024, ${theme}`, () => {
    test.use({ viewport: { width: 768, height: 1024 } });

    test("keeps the picks on one row", async ({ page }) => {
      await openCard(page, `set=worst&theme=${theme}`);
      const shown = page.getByRole("list", { name: "Your estimates" }).locator("li:visible");
      const tops = new Set<number>();
      for (const chip of await shown.all()) tops.add(Math.round((await chip.boundingBox())!.y));
      expect(tops.size).toBe(1);
      expect(await sideways(page)).toBe(0);
    });
  });

  test.describe(`the Predict card's chips against the mock, ${theme}`, () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test("draws each side as a stroked arrow beside a semibold value", async ({ page }) => {
      await openCard(page, `set=normal&theme=${theme}`);
      const chip = page.getByRole("list", { name: "Your estimates" }).locator("li").first();
      const value = chip.locator("span").last();
      expect(await value.evaluate((element) => getComputedStyle(element).fontWeight)).toBe("600");
      const arrow = chip.getByRole("img", { name: "above the market" });
      expect(await arrow.evaluate((element) => element.querySelector("path")!.getAttribute("stroke"))).toBe(
        "currentColor",
      );
    });
  });
}
