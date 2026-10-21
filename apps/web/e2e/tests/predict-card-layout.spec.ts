import { expect, test, type Locator, type Page } from "@playwright/test";

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

/** The visible card inside the dock: the bar while pinned, the card once docked. */
const panelBox = (page: Page) =>
  page
    .locator("[data-predict-dock] > *")
    .first()
    .evaluate((element) => element.getBoundingClientRect().toJSON() as DOMRect);

/** A held button's fill, ink and edge against the disabled tokens the card's own Predict wears. */
const heldTone = (button: Locator) =>
  button.evaluate((element) => {
    const probe = document.createElement("div");
    probe.style.cssText = "background: var(--fs-popup-cta-disabled); color: var(--fs-popup-cta-disabled-text)";
    document.body.append(probe);
    const tokens = getComputedStyle(probe);
    const [fill, ink] = [tokens.backgroundColor, tokens.color];
    probe.remove();
    const style = getComputedStyle(element);
    return {
      fill: style.backgroundColor === fill,
      ink: getComputedStyle(element.querySelector(".button-text") ?? element).color === ink,
      edge: style.borderTopColor === fill || style.borderTopColor === "rgba(0, 0, 0, 0)",
    };
  });

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

    test("never pins the card, however far down it sits", async ({ page }) => {
      await openCard(page, `set=normal&rows=14&theme=${theme}`);
      await expect(page.locator("[data-predict-dock]")).toHaveCount(1);
      await expect(page.locator("[data-stuck]")).toHaveCount(0);
      expect(await page.getByRole("heading", { name: "Place your estimates" }).isVisible()).toBe(true);
      await expect(page.getByRole("button", { name: "Predict 3 estimates" })).not.toBeInViewport();
    });

    test("holds Predict while a run is stored and says why with the run", async ({ page }) => {
      await openCard(page, `set=worst&theme=${theme}&run=stored`);
      await expect(page.getByText(/did not finish\. Resume or discard it before starting a new one\.$/)).toBeVisible();
      await expect(page.getByRole("button", { name: "Predict 6 estimates" })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Resume" })).toBeEnabled();
      await expect(page.locator("[data-predict-dock]")).toHaveCount(0);
    });

    test("makes Resume the card's main button while a run is stored, in Predict's place and size", async ({ page }) => {
      await openCard(page, `set=normal&theme=${theme}`);
      const live = (await page.getByRole("button", { name: "Predict 3 estimates" }).boundingBox())!;
      const heading = (await page.getByRole("heading", { name: "Place your estimates" }).boundingBox())!;
      await openCard(page, `set=normal&theme=${theme}&run=stored`);
      const resume = (await page.getByRole("button", { name: "Resume" }).boundingBox())!;
      expect(resume.height).toBe(44);
      expect(resume.y).toBe(live.y);
      expect(Math.round(resume.x + resume.width)).toBe(Math.round(live.x + live.width));
      expect((await page.getByRole("heading", { name: "Place your estimates" }).boundingBox())!.y).toBe(heading.y);
      const held = page.getByRole("button", { name: "Predict 3 estimates" });
      await expect(held).toBeDisabled();
      expect((await held.boundingBox())!.height).toBeLessThan(44);
      expect(await heldTone(held)).toEqual({ fill: true, ink: true, edge: true });
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

      test("draws no band under the header, picked or not", async ({ page }) => {
        for (const set of ["none", "normal"]) {
          await openCard(page, `set=${set}&theme=${theme}`);
          // the 64px header, its 1px rule and the page's 40px top padding
          expect((await page.getByRole("heading", { name: "City populations" }).boundingBox())!.y).toBe(105);
        }
      });

      test("slides a bar up from the bottom edge with the first pick, Predict in it", async ({ page }) => {
        await openCard(page, `set=none&rows=14&theme=${theme}`);
        await expect(page.locator("[data-predict-dock]")).toHaveCount(0);
        await page.evaluate(() => (window as unknown as { pickFirst: () => void }).pickFirst());
        const dock = page.locator("[data-predict-dock][data-stuck]");
        await expect(dock).toHaveCount(1);
        await expect.poll(async () => (await panelBox(page)).left).toBe(0);
        const panel = await panelBox(page);
        expect(panel.bottom).toBe(viewport.height);
        expect(panel.left).toBe(0);
        expect(panel.width).toBe(viewport.width);
        expect(panel.height).toBe(77);
        const predict = page.getByRole("button", { name: "Predict", exact: true });
        await expect(predict).toBeInViewport();
        expect((await predict.boundingBox())!.height).toBe(44);
        await expect(page.getByRole("heading", { name: "Place your estimates" })).not.toBeInViewport();
        await expect(page.getByRole("list", { name: "Your estimates" }).locator("li:visible")).toHaveText([
          "Berlin400",
        ]);
        expect(await sideways(page)).toBe(0);
      });

      test("holds one chip and a count of the rest while pinned, a long name cut short", async ({ page }) => {
        await openCard(page, `set=worst&rows=14&theme=${theme}`);
        await expect(page.locator("[data-predict-dock][data-stuck]")).toHaveCount(1);
        const shown = page.getByRole("list", { name: "Your estimates" }).locator("li:visible");
        await expect(shown).toHaveText([/^Gr.*1,234,567$/, "+5"]);
        const value = shown.first().locator("span").last();
        expect(await value.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
        const panel = await panelBox(page);
        expect(panel.height).toBe(77);
        for (const item of await shown.all()) {
          const box = (await item.boundingBox())!;
          expect(box.y + box.height).toBeLessThanOrEqual(panel.bottom);
        }
        expect(await sideways(page)).toBe(0);
      });

      test("keeps enough of a long name in the pinned chip to say which option it is", async ({ page }) => {
        await openCard(page, `set=worst&rows=14&theme=${theme}`);
        await expect(page.locator("[data-predict-dock][data-stuck]")).toHaveCount(1);
        const name = page
          .getByRole("list", { name: "Your estimates" })
          .locator("li:visible")
          .first()
          .locator("span")
          .first();
        const [shown, eight] = await name.evaluate((element) => {
          const range = document.createRange();
          range.setStart(element.firstChild!, 0);
          range.setEnd(element.firstChild!, 8);
          return [element.clientWidth, range.getBoundingClientRect().width];
        });
        expect(shown).toBeGreaterThanOrEqual(eight);
      });

      test("docks into the card when the page reaches it, with one Predict on screen", async ({ page }) => {
        await openCard(page, `set=normal&rows=14&theme=${theme}`);
        const dock = page.locator("[data-predict-dock]");
        await expect(dock).toHaveAttribute("data-stuck", "");
        const height = await dock.evaluate((element) => (element as HTMLElement).offsetHeight);
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await expect(dock).not.toHaveAttribute("data-stuck");
        await expect(page.getByRole("heading", { name: "Place your estimates" })).toBeInViewport();
        // in the page's column again, inside the gutters
        await expect.poll(async () => (await panelBox(page)).left).toBe(viewport.width <= 640 ? 16 : 24);
        await expect(page.getByRole("button", { name: /^Predict/ }).locator("visible=true")).toHaveCount(1);
        await expect(page.getByRole("list", { name: "Your estimates" }).locator("li:visible")).toHaveText([
          "Berlin400",
          "Lisbon360",
          "+1",
        ]);
        // the card takes the same room in the page pinned or not
        expect(await dock.evaluate((element) => (element as HTMLElement).offsetHeight)).toBe(height);

        await page.evaluate(() => window.scrollTo(0, 0));
        await expect(dock).toHaveAttribute("data-stuck", "");
        await expect(page.getByRole("button", { name: /^Predict/ }).locator("visible=true")).toHaveCount(1);
      });

      test("keeps one footprint when picks change while the bar is pinned", async ({ page }) => {
        await openCard(page, `set=none&rows=14&theme=${theme}`);
        await page.evaluate(() => (window as unknown as { pickFirst: () => void }).pickFirst());
        await expect(page.locator("[data-stuck]")).toHaveCount(1);
        await page.evaluate(() => (window as unknown as { pickAll: () => void }).pickAll());
        const held = await page.evaluate(() => document.documentElement.scrollHeight);
        // every scroll position, step by step down to the end: the bar docks once, into the card's own place
        const { misplaced, flips } = await page.evaluate(async () => {
          const dock = document.querySelector<HTMLElement>("[data-predict-dock]")!;
          const found: string[] = [];
          let changes = 0;
          const watch = new MutationObserver((records) => (changes += records.length));
          watch.observe(dock, { attributes: true, attributeFilter: ["data-stuck"] });
          for (let y = 0; y <= document.documentElement.scrollHeight; y += 6) {
            window.scrollTo(0, y);
            await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
            if (dock.hasAttribute("data-stuck")) continue;
            const above = dock.previousElementSibling!.getBoundingClientRect().bottom;
            if (dock.getBoundingClientRect().top < above)
              found.push(`${y}: ${above - dock.getBoundingClientRect().top}px`);
          }
          watch.disconnect();
          return { misplaced: found, flips: changes };
        });
        expect(misplaced).toEqual([]);
        expect(flips).toBe(1);
        await expect(page.locator("[data-stuck]")).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(held);
      });

      test("leaves every option clear of the bar at the end of the page", async ({ page }) => {
        await openCard(page, `set=normal&rows=14&theme=${theme}`);
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await expect(page.locator("[data-predict-dock]")).not.toHaveAttribute("data-stuck");
        const panel = await panelBox(page);
        const last = (await page.getByTestId("option-card").last().boundingBox())!;
        expect(last.y + last.height).toBeLessThanOrEqual(panel.top);
      });

      test("scrolls a focused control clear of the pinned bar", async ({ page }) => {
        await openCard(page, `set=normal&rows=14&theme=${theme}`);
        await expect(page.locator("[data-stuck]")).toHaveCount(1);
        const padding = await page.evaluate(() => getComputedStyle(document.documentElement).scrollPaddingBottom);
        expect(parseFloat(padding)).toBeGreaterThanOrEqual(77);
      });

      test("pads the pinned bar over the home indicator", async ({ page }) => {
        await openCard(page, `set=normal&rows=14&theme=${theme}`);
        // Chromium resolves env() to 0, so the rule itself is what can be read
        const rules = await page.evaluate(() =>
          [...document.styleSheets].flatMap((sheet) => {
            const found: string[] = [];
            const walk = (list: CSSRuleList) => {
              for (const rule of list) {
                if ("cssRules" in rule) walk((rule as CSSGroupingRule).cssRules);
                if (rule instanceof CSSStyleRule && rule.selectorText.includes("[data-stuck]"))
                  found.push(rule.cssText);
              }
            };
            walk(sheet.cssRules);
            return found;
          }),
        );
        expect(rules.some((rule) => /padding-bottom:[^;]*env\(safe-area-inset-bottom/.test(rule))).toBe(true);
      });

      test("sits under an open dialog", async ({ page }) => {
        // the open dialog hides the page from the accessibility tree, so the card is found by its markup
        await page.emulateMedia({ reducedMotion: "reduce" });
        await openHarness(page, `${harness.url}?set=normal&rows=14&theme=${theme}&dialog=1`);
        await expect(page.getByRole("dialog")).toBeVisible();
        await expect(page.locator("[data-stuck]")).toHaveCount(1);
        const panel = await panelBox(page);
        const isOnTop = await page.evaluate(
          ([x, y]) => document.elementFromPoint(x!, y!)?.closest("[data-predict-dock]") !== null,
          [panel.left + 8, panel.bottom - 8],
        );
        expect(isOnTop).toBe(false);
      });

      test("lets the bar leave as it came when the last pick goes, rather than vanish", async ({ page }) => {
        await openCard(page, `set=normal&rows=14&theme=${theme}`);
        await expect(page.locator("[data-stuck]")).toHaveCount(1);
        const leaving = await page.evaluate(async () => {
          (window as unknown as { clearPicks: () => void }).clearPicks();
          await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
          const dock = document.querySelector<HTMLElement>("[data-predict-dock]");
          const panel = dock?.firstElementChild as HTMLElement | undefined;
          return {
            phase: dock?.getAttribute("data-leaving") ?? null,
            height: panel?.getBoundingClientRect().height,
            text: panel?.innerText.replace(/\s+/g, " ").trim(),
          };
        });
        // the bar sinks as it was, not as the card it leaves behind
        const chip = viewport.width < 360 ? "Berlin" : "Berlin 400";
        expect(leaving).toEqual({ phase: "", height: 77, text: `Place your estimates ${chip} +2 Predict` });
        await expect(page.locator("[data-predict-dock]")).toHaveCount(0);
        await expect(page.locator("[data-stuck]")).toHaveCount(0);
      });

      test("lists two picks and a count of the rest on the card", async ({ page }) => {
        await openCard(page, `set=worst&theme=${theme}`);
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await expect(page.locator("[data-stuck]")).toHaveCount(0);
        await expect.poll(async () => (await panelBox(page)).left).toBe(16);
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

      for (const query of ["wallet=0", "status=closed"]) {
        test(`draws no bar while Predict is off (${query}), and the card says why`, async ({ page }) => {
          await openCard(page, `set=worst&theme=${theme}&${query}`);
          await expect(page.locator("[data-predict-dock]")).toHaveCount(0);
          await expect(page.getByRole("button", { name: "Predict", exact: true })).toBeVisible();
          await expect(page.getByRole("button", { name: "Predict", exact: true })).toBeDisabled();
          await expect(page.getByText(/^(Connect a wallet to predict\.|Trading has closed\.)$/)).toBeVisible();
        });
      }

      for (const [run, reason] of [
        ["stored", "Resume or discard it before starting a new one."],
        ["pending", "Resume it before starting a new one."],
      ] as const) {
        test(`holds Predict and draws no bar while a run is ${run}, and says why with the run`, async ({ page }) => {
          await openCard(page, `set=worst&rows=14&theme=${theme}&run=${run}`);
          await expect(page.getByRole("button", { name: "Predict", exact: true })).toBeDisabled();
          await expect(page.locator("[data-predict-dock]")).toHaveCount(0);
          await page.getByRole("heading", { name: "Place your estimates" }).scrollIntoViewIfNeeded();
          // the reason closes the run's own paragraph, and Resume sits beside or right under it
          const said = page.locator("p").filter({ hasText: reason });
          await expect(said).toHaveCount(1);
          await expect(said).toHaveText(
            new RegExp(`^A prediction with .* did not finish\\. .*${reason.replace(".", "\\.")}$`),
          );
          // Resume is the card's main button; the held Predict sits right under the run's words
          const resume = page.getByRole("button", { name: "Resume" });
          await expect(resume).toBeEnabled();
          expect((await resume.boundingBox())!.height).toBe(44);
          const held = page.getByRole("button", { name: "Predict", exact: true });
          // held in the disabled tone the card's own Predict has, apart from the live Discard beside it
          expect(await heldTone(held)).toEqual({ fill: true, ink: true, edge: true });
          const [text, button] = [(await said.boundingBox())!, (await held.boundingBox())!];
          expect(button.y).toBeGreaterThanOrEqual(text.y);
          expect(button.y).toBeLessThanOrEqual(text.y + text.height + 12);
          expect(await sideways(page)).toBe(0);
        });
      }

      test("draws no bar, and keeps the card's own Predict, while nothing is picked", async ({ page }) => {
        await openCard(page, `set=none&rows=14&theme=${theme}`);
        await expect(page.locator("[data-predict-dock]")).toHaveCount(0);
        const predict = page.getByRole("button", { name: "Predict", exact: true });
        await expect(predict).not.toBeInViewport();
        await predict.scrollIntoViewIfNeeded();
        await expect(predict).toBeDisabled();
      });
    });
  }
}

for (const theme of ["light", "dark"]) {
  test.describe(`the Predict card on a phone on its side, 568 x 320, ${theme}`, () => {
    test.use({ viewport: { width: 568, height: 320 } });

    test("pins a slimmer bar, edge to edge, and docks it into the card", async ({ page }) => {
      await openCard(page, `set=worst&rows=14&theme=${theme}`);
      // among the options, as when picking: the bar cannot rise above the top of the section it is in
      await page.evaluate(() => window.scrollTo(0, 400));
      await expect(page.locator("[data-stuck]")).toHaveCount(1);
      await expect.poll(async () => (await panelBox(page)).bottom).toBe(320);
      const panel = await panelBox(page);
      expect(panel.width).toBe(568);
      expect(panel.height).toBe(61);
      await expect(page.getByRole("button", { name: "Predict", exact: true })).toBeInViewport();
      expect(await sideways(page)).toBe(0);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await expect(page.locator("[data-stuck]")).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Predict/ }).locator("visible=true")).toHaveCount(1);
    });
  });

  test.describe(`the Predict card on a phone on its side, 844 x 390, ${theme}`, () => {
    test.use({ viewport: { width: 844, height: 390 } });

    test("pins no bar over the options and keeps Predict on the card", async ({ page }) => {
      await openCard(page, `set=worst&rows=14&theme=${theme}`);
      await expect(page.locator("[data-stuck]")).toHaveCount(0);
      const predict = page.getByRole("button", { name: "Predict 6 estimates" });
      await predict.scrollIntoViewIfNeeded();
      await expect(predict).toBeInViewport();
    });
  });

  test.describe(`the Predict card between 641 and 767px, ${theme}`, () => {
    test.use({ viewport: { width: 700, height: 1000 } });

    test("lines the pinned bar's first chip up with the page's gutter", async ({ page }) => {
      await openCard(page, `set=normal&rows=14&theme=${theme}`);
      await expect(page.locator("[data-stuck]")).toHaveCount(1);
      const chip = page.getByRole("list", { name: "Your estimates" }).locator("li:visible").first();
      const heading = page.getByRole("heading", { name: "City populations" });
      expect((await chip.boundingBox())!.x).toBe((await heading.boundingBox())!.x);
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

/** Puts the first pick in and reads the animation the bar arrives with, a frame later. */
const risesWith = (page: Page) =>
  page.evaluate(async () => {
    (window as unknown as { pickFirst: () => void }).pickFirst();
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    const dock = document.querySelector("[data-predict-dock]");
    return dock ? getComputedStyle(dock).animationName : null;
  });

test.describe("the phone bar's motion", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("rises from the bottom edge, and only on the first pick, not on scrolling back up", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openHarness(page, `${harness.url}?set=none&rows=14`);
    expect(await risesWith(page)).toBe("fsLiftIn");
    const dock = page.locator("[data-predict-dock]");
    await expect(dock).toHaveAttribute("data-stuck", "");
    await expect.poll(() => dock.evaluate((element) => element.getAnimations().length)).toBe(0);

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(dock).not.toHaveAttribute("data-stuck");
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(dock).toHaveAttribute("data-stuck", "");
    expect(await dock.evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  });

  test("docks without replaying the second chip's entrance", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openHarness(page, `${harness.url}?set=normal&rows=14`);
    await expect(page.locator("[data-stuck]")).toHaveCount(1);
    // the docked card's second chip, as it was when its entrance ran on the first pick
    const running = () =>
      page.evaluate(
        () =>
          document
            .querySelectorAll('[aria-label="Your estimates"] > li')[1]!
            .getAnimations()
            .filter((animation) => animation.playState === "running").length,
      );
    await expect.poll(running).toBe(0);
    await page.evaluate(async () => {
      window.scrollTo(0, document.documentElement.scrollHeight);
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    });
    const replayed = await running();
    await expect(page.locator("[data-stuck]")).toHaveCount(0);
    expect(replayed).toBe(0);
  });

  test("does not rise when a wide window that went live long ago narrows past md", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.setViewportSize({ width: 1280, height: 800 });
    await openHarness(page, `${harness.url}?set=normal&rows=14`);
    await expect(page.locator("[data-predict-dock]")).toHaveCount(1);
    await expect(page.locator("[data-entering]")).toHaveCount(0);
    await page.setViewportSize({ width: 375, height: 812 });
    const dock = page.locator("[data-predict-dock]");
    await expect(dock).toHaveAttribute("data-stuck", "");
    expect(await dock.evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  });

  test("lets go of a leaving bar whose exit is cut short by the window widening past md", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openHarness(page, `${harness.url}?set=normal&rows=14`);
    await expect(page.locator("[data-stuck]")).toHaveCount(1);
    await page.evaluate(() => (window as unknown as { clearPicks: () => void }).clearPicks());
    await expect(page.locator("[data-leaving]")).toHaveCount(1);
    await page.setViewportSize({ width: 800, height: 812 });
    await expect(page.locator("[data-predict-dock]")).toHaveCount(0);
    await expect(page.locator("[inert]")).toHaveCount(0);
  });

  test("fades in place under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openHarness(page, `${harness.url}?set=none&rows=14`);
    expect(await risesWith(page)).toBe("fsFadeIn");
  });
});
