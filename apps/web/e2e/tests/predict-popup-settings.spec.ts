import { expect, test, type Locator, type Page } from "@playwright/test";

import { openHarness, startHarness } from "../utils/component-harness";

/** The windows and themes every new state is drawn in. */
const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 375, height: 667 },
];
const THEMES = ["light", "dark"] as const;
const TRADES_FIELD = "Max slippage, custom percent";
const CREDITS_FIELD = "Credits swap slippage, custom percent";

let harness: Awaited<ReturnType<typeof startHarness>>;

test.beforeAll(async () => {
  harness = await startHarness("predict-popup");
});

test.afterAll(async () => {
  await harness?.close();
});

/** Opens the harness with `query`, `?` params of e2e/harness/predict-popup/main.tsx, two options unless it names a count. */
async function openPopup(page: Page, query: string) {
  await openHarness(page, `${harness.url}?${query.includes("options=") ? "" : "options=2&"}${query}`);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Close" })).toBeVisible();
  await settle(dialog);
  return dialog;
}

/** Waits out every finite animation and transition in the dialog. */
async function settle(dialog: Locator) {
  await dialog.evaluate((element) =>
    Promise.all(
      element
        .getAnimations({ subtree: true })
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        // the cue's nudge ends where it starts, and waiting it out would end it
        .filter((animation) => (animation as CSSAnimation).animationName !== "fsNudgeDown")
        .filter((animation) => animation.timeline === document.timeline)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}

/** The boxes the settings must not move: the dialog and its button's place. */
async function footprint(dialog: Locator) {
  const round = (value: number) => Math.round(value * 10) / 10;
  const box = (await dialog.boundingBox())!;
  const button = (await dialog.locator(".predict-footer > .predict-cta").boundingBox())!;
  return {
    dialog: [box.x, box.y, box.width, box.height].map(round),
    footer: [button.x, button.y, button.width, button.height].map(round),
  };
}

/** True when the element is whole inside the window and every clipping ancestor, and nothing paints over its centre. */
function isWhole(locator: Locator): Promise<boolean> {
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
    if (rect.top < clip.top - 1 || rect.left < clip.left - 1 || rect.bottom > clip.bottom + 1) return false;
    if (rect.right > clip.right + 1) return false;
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return hit !== null && (hit === element || element.contains(hit));
  });
}

for (const viewport of VIEWPORTS) {
  test.describe(`the settings at ${viewport.width} x ${viewport.height}`, () => {
    test.use({ viewport });

    for (const theme of THEMES) {
      test(`open over the body from the gear and keep the popup's footprint, in the ${theme} theme`, async ({
        page,
      }) => {
        const dialog = await openPopup(page, `theme=${theme}`);
        const before = await footprint(dialog);

        await dialog.getByRole("button", { name: "Settings", exact: true }).click();
        await settle(dialog);

        expect(await footprint(dialog)).toEqual(before);
        await expect(dialog.getByRole("heading", { level: 2, name: "Settings" })).toBeVisible();
        expect(await isWhole(dialog.getByRole("textbox", { name: TRADES_FIELD }))).toBe(true);
        // a visitor with no credits has no credits swap to set
        await expect(dialog.getByRole("textbox", { name: CREDITS_FIELD })).toHaveCount(0);
        expect(await isWhole(dialog.getByRole("button", { name: "Done" }))).toBe(true);
        // the body is under the panel, covered and out of the focus order
        const predict = dialog.locator(".predict-footer > .predict-cta");
        expect(await isWhole(predict)).toBe(false);
        expect(
          await predict.evaluate((element: HTMLElement) => (element.focus(), document.activeElement === element)),
        ).toBe(false);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      });

      test(`warn on a high custom slippage in the warning tone, in the ${theme} theme`, async ({ page }) => {
        const dialog = await openPopup(page, `theme=${theme}&settings=open&slippage=trade:800`);
        const warning = dialog.getByText("High slippage. A trade may fill at a much worse price.");

        await expect(warning).toBeVisible();
        expect(await isWhole(warning)).toBe(true);
        const [color, tone] = await warning.evaluate((element) => {
          const probe = document.createElement("span");
          probe.style.color = "var(--fs-tone-warning-text)";
          element.append(probe);
          const expected = getComputedStyle(probe).color;
          probe.remove();
          return [getComputedStyle(element).color, expected];
        });
        expect(color).toBe(tone);
      });

      test(`draws the high-slippage panel as reviewed, in the ${theme} theme`, async ({ page }) => {
        await page.emulateMedia({ reducedMotion: "reduce" });
        const dialog = await openPopup(
          page,
          `theme=${theme}&settings=open&credits=enough&slippage=trade:800,credits:50`,
        );
        await dialog.getByRole("textbox", { name: TRADES_FIELD }).blur();
        await settle(dialog);

        await expect(page).toHaveScreenshot(`settings-${viewport.width}x${viewport.height}-${theme}.png`, {
          animations: "disabled",
        });
      });
    }
  });
}

test.describe("the settings on a phone on its side at 844 x 390", () => {
  test.use({ viewport: { width: 844, height: 390 } });

  test("open under the header, whole, from a popup scrolled to its end", async ({ page }) => {
    const dialog = await openPopup(page, "theme=light&options=10");
    const gear = dialog.getByRole("button", { name: "Settings", exact: true });
    const scrolled = await gear.evaluate((element) => {
      let scroller = element.parentElement!;
      while (getComputedStyle(scroller).overflowY !== "auto") scroller = scroller.parentElement!;
      scroller.scrollTop = scroller.scrollHeight;
      return scroller.scrollTop;
    });
    expect(scrolled, "the popup scrolls on a phone on its side").toBeGreaterThan(0);

    await gear.click();
    await settle(dialog);

    const header = (await dialog.locator(".predict-header").boundingBox())!;
    const panel = (await dialog.locator(".predict-settings").boundingBox())!;
    expect(Math.round(panel.y)).toBe(Math.round(header.y + header.height));
    expect(await isWhole(dialog.getByRole("textbox", { name: TRADES_FIELD }))).toBe(true);
    expect(await isWhole(dialog.getByRole("button", { name: "Done" }))).toBe(true);
    expect(await isWhole(dialog.locator(".predict-footer > .predict-cta"))).toBe(false);
  });
});

test.describe("the settings by keyboard", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("open from the gear with Enter, reach each choice with Tab, and close on Escape back to the gear", async ({
    page,
  }) => {
    const dialog = await openPopup(page, "theme=light");
    const gear = dialog.getByRole("button", { name: "Settings", exact: true });

    await gear.focus();
    await page.keyboard.press("Enter");
    await settle(dialog);
    const auto = dialog.locator('[data-slippage="tradeBps"]').getByRole("button", { name: "Auto" });
    await expect(auto).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("textbox", { name: TRADES_FIELD })).toBeFocused();
    await page.keyboard.type("2");
    await page.keyboard.press("Escape");

    await expect(gear).toBeFocused();
    await expect(gear).toHaveAttribute("aria-expanded", "false");
    await expect(dialog).toBeVisible();
  });

  test("wrap Tab at the panel's last control to the gear, and Shift+Tab at the gear back to it", async ({ page }) => {
    const dialog = await openPopup(page, "theme=light&credits=enough&settings=open");
    const gear = dialog.getByRole("button", { name: "Settings", exact: true });
    const done = dialog.getByRole("button", { name: "Done" });

    await done.focus();
    await page.keyboard.press("Tab");
    await expect(gear).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(done).toBeFocused();
  });

  test("keep an out-of-range entry and its error once the field is left, saving nothing", async ({ page }) => {
    const dialog = await openPopup(page, "theme=light&settings=open");
    const field = dialog.getByRole("textbox", { name: TRADES_FIELD });

    await field.fill("60");
    await expect(field).not.toHaveAttribute("aria-invalid");
    await dialog.getByRole("heading", { name: "Max slippage" }).click();

    await expect(field).toHaveValue("60");
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(dialog.getByText("Enter a percent from 0.01 to 50.")).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("foresight-predict-slippage") ?? "")).not.toContain(
      '"tradeBps":6',
    );
  });

  test("keep a custom value in the browser across a reload", async ({ page }) => {
    await openPopup(page, "theme=light&slippage=trade:250");
    await page.goto(`${harness.url}?options=2&settings=open`);
    await settle(page.getByRole("dialog"));

    await expect(page.getByRole("dialog").getByRole("textbox", { name: TRADES_FIELD })).toHaveValue("2.5");
  });

  test("open by opacity alone under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const dialog = await openPopup(page, "theme=light&settings=open");

    const style = await dialog
      .locator(".predict-settings-card")
      .evaluate((element) => [getComputedStyle(element).transform, getComputedStyle(element).filter]);
    expect(style).toEqual(["none", "none"]);
  });
});

test.describe("the settings, compact", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("sit in a card under the header, sized to its rows, over the dimmed body that closes them", async ({ page }) => {
    const dialog = await openPopup(page, "theme=light&credits=enough&settings=open");
    const header = (await dialog.locator(".predict-header").boundingBox())!;
    const card = (await dialog.locator(".predict-settings-card").boundingBox())!;
    const panel = (await dialog.locator(".predict-settings").boundingBox())!;

    // the header's own 8px gap, then 4px
    expect(card.y - (header.y + header.height)).toBeLessThanOrEqual(12);
    expect(card.height).toBeLessThan(panel.height / 2);
    expect(await isWhole(dialog.getByRole("button", { name: "Reset" }))).toBe(true);
    await expect(dialog.getByRole("textbox", { name: TRADES_FIELD })).toHaveAttribute("placeholder", "1");

    await page.mouse.click(panel.x + panel.width / 2, panel.y + panel.height - 40);
    await settle(dialog);
    await expect(dialog.getByRole("button", { name: "Settings", exact: true })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  test("keep Auto's whole target under a warning", async ({ page }) => {
    const dialog = await openPopup(page, "theme=light&settings=open&slippage=trade:800");
    const auto = dialog.locator('[data-slippage="tradeBps"]').getByRole("button", { name: "Auto" });
    const box = (await auto.boundingBox())!;

    const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("button")?.textContent, {
      x: box.x + box.width / 2,
      y: box.y + box.height + 5,
    });
    expect(hit).toBe("Auto");
  });

  test("offer Reset on an entry it refused, back to Auto", async ({ page }) => {
    const dialog = await openPopup(page, "theme=light&settings=open");
    const field = dialog.getByRole("textbox", { name: TRADES_FIELD });
    await field.fill("99");
    await dialog.getByRole("heading", { name: "Max slippage" }).click();
    const reset = dialog.getByRole("button", { name: "Reset" });

    await expect(reset).toBeEnabled();
    await reset.click();

    await expect(field).toHaveValue("");
    await expect(dialog.locator('[data-slippage="tradeBps"]').getByRole("button", { name: "Auto" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("ring the gear's mark in the gear's own fill while the settings are open", async ({ page }) => {
    const dialog = await openPopup(page, "theme=light&settings=open&slippage=trade:300");
    const gear = dialog.getByRole("button", { name: "Settings", exact: true });
    const [fill, ring] = await gear.evaluate((element) => [
      getComputedStyle(element).backgroundColor,
      getComputedStyle(element.querySelector("[data-testid=settings-custom]")!).boxShadow,
    ]);

    expect(ring).toContain(`${fill} 0px 0px 0px 2px`);
  });

  test("mark the gear while a custom value is set", async ({ page }) => {
    const auto = await openPopup(page, "theme=light");
    await expect(auto.getByTestId("settings-custom")).toHaveCount(0);

    const custom = await openPopup(page, "theme=light&slippage=trade:300");
    const dot = custom.getByTestId("settings-custom");
    await expect(dot).toBeVisible();
    expect(await isWhole(dot)).toBe(true);
  });

  test("open after a run stopped with money moved", async ({ page }) => {
    const dialog = await openPopup(page, "theme=light&state=failed&reason=reverted&first=0");
    const gear = dialog.getByRole("button", { name: "Settings", exact: true });

    await expect(gear).toBeEnabled();
    await gear.click();
    await settle(dialog);
    expect(await isWhole(dialog.getByRole("textbox", { name: TRADES_FIELD }))).toBe(true);
  });
});

test.describe("plans moved by the visitor's new slippage at 320 x 568", () => {
  test.use({ viewport: { width: 320, height: 568 } });

  test("say so whole on the status line and confirm the new trades, keeping the popup's footprint", async ({
    page,
  }) => {
    const before = await footprint(await openPopup(page, "theme=light&state=moved"));
    const dialog = await openPopup(page, "theme=light&state=moved&movedBy=slippage");

    // the button sizes to its own label beside Go back, so only its row is held
    const after = await footprint(dialog);
    expect(after.dialog).toEqual(before.dialog);
    expect([after.footer[1], after.footer[3]]).toEqual([before.footer[1], before.footer[3]]);
    const status = dialog.getByRole("status");
    await expect(status).toHaveText("Your new slippage changes the trades. Check Details, then confirm.");
    expect(await status.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
    await expect(dialog.getByRole("button", { name: "Confirm trades" })).toBeEnabled();
  });
});

test.describe("prices that moved at 320 x 568", () => {
  test.use({ viewport: { width: 320, height: 568 } });

  for (const theme of THEMES) {
    test(`stack Confirm over Go back inside the popup's footprint, in the ${theme} theme`, async ({ page }) => {
      const before = await openPopup(page, `theme=${theme}`);
      await before.getByTestId("predict-summary").getByRole("button").first().click();
      await settle(before);
      const idle = await footprint(before);
      const dialog = await openPopup(page, `theme=${theme}&state=moved`);

      // the dialog keeps its box; Confirm keeps Predict's width and height, Go back takes a row of its own under it
      const moved = await footprint(dialog);
      expect(moved.dialog).toEqual(idle.dialog);
      expect([moved.footer[0], moved.footer[2], moved.footer[3]]).toEqual([
        idle.footer[0],
        idle.footer[2],
        idle.footer[3],
      ]);
      const confirm = dialog.getByRole("button", { name: "Confirm new prices" });
      const back = dialog.getByRole("button", { name: "Go back" });
      await expect(confirm).toBeEnabled();
      const [over, under] = [(await confirm.boundingBox())!, (await back.boundingBox())!];
      expect(under.y).toBeCloseTo(over.y + over.height + 8, 0);
      expect([under.x, under.width, under.height]).toEqual([over.x, over.width, over.height]);
      expect(await isWhole(confirm)).toBe(true);
      expect(await isWhole(back)).toBe(true);
      const footer = dialog.locator(".predict-footer");
      expect(await footer.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      expect(await isWhole(dialog.getByTestId("status-text"))).toBe(true);
      await expect(page).toHaveScreenshot(`moved-320x568-${theme}.png`, { animations: "disabled" });
    });
  }
});

test.describe("the moved footer's focus order", () => {
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 375, height: 667 },
  ]) {
    test(`runs as Confirm new prices and Go back are drawn, at ${viewport.width} wide`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const dialog = await openPopup(page, "state=moved");
      const confirm = dialog.getByRole("button", { name: "Confirm new prices" });
      const back = dialog.getByRole("button", { name: "Go back" });
      const [c, b] = [(await confirm.boundingBox())!, (await back.boundingBox())!];
      // stacked, the first drawn is the higher one; in a row, the one to the left
      const [first, second] = (c.y === b.y ? c.x < b.x : c.y < b.y) ? [confirm, back] : [back, confirm];

      await first.focus();
      await page.keyboard.press("Tab");
      await expect(second).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(first).toBeFocused();
    });
  }

  test("brings Go back in with the enter motion", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    const dialog = await openPopup(page, "state=moved");
    const wrapper = dialog
      .locator(".predict-footer > div")
      .filter({ has: page.getByRole("button", { name: "Go back" }) });
    expect(await wrapper.evaluate((element) => getComputedStyle(element).animationName)).toBe("fsFadeUp");
  });
});

test.describe("prices that could not be read", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("offer Try again in the button's place, keeping the popup's footprint", async ({ page }) => {
    const idle = await openPopup(page, "theme=light");
    const before = await footprint(idle);
    const dialog = await openPopup(page, "theme=light&prices=failed");

    expect(await footprint(dialog)).toEqual(before);
    await expect(dialog.getByRole("status")).toHaveText("Prices could not be read.");
    await expect(dialog.getByRole("button", { name: "Try again" })).toBeEnabled();
  });
});

for (const viewport of VIEWPORTS) {
  test.describe(`prices that moved at ${viewport.width} x ${viewport.height}`, () => {
    test.use({ viewport });

    for (const theme of THEMES) {
      test(`keep the popup's footprint, say so whole on the status line and ask to confirm, in the ${theme} theme`, async ({
        page,
      }) => {
        // moved opens Details, the one region that may add to the popup, so idle is measured with it open
        const before = await openPopup(page, `theme=${theme}`);
        await before.getByTestId("predict-summary").getByRole("button").first().click();
        await settle(before);
        const idle = await footprint(before);
        const dialog = await openPopup(page, `theme=${theme}&state=moved`);

        // Go back shares the button's row, so only its width gives way
        const moved = await footprint(dialog);
        expect(moved.dialog).toEqual(idle.dialog);
        expect([moved.footer[1], moved.footer[3]]).toEqual([idle.footer[1], idle.footer[3]]);
        const status = dialog.getByRole("status");
        await expect(status).toHaveText(/^\S.* now goes to .+, not .+\. Confirm to go on\.$/);
        expect(await isWhole(status.getByTestId("status-text"))).toBe(true);
        await expect(dialog.getByRole("button", { name: "Confirm new prices" })).toBeEnabled();
        expect(await isWhole(dialog.getByRole("button", { name: "Go back" }))).toBe(true);
      });

      test(`name the changed move's figures before, in the ${theme} theme`, async ({ page }) => {
        const dialog = await openPopup(page, `theme=${theme}&state=moved`);
        // Details opens on its own at moved
        await expect(dialog.getByTestId("predict-summary").getByRole("button").first()).toHaveAttribute(
          "aria-expanded",
          "true",
        );
        await settle(dialog);
        const was = dialog.getByTestId("market-was");

        await was.scrollIntoViewIfNeeded();
        await expect(was).toHaveText(/^Before: 250 → \d+(\.\d+)? \$M$/);
        expect(await isWhole(was)).toBe(true);
        await expect(page).toHaveScreenshot(`moved-${viewport.width}x${viewport.height}-${theme}.png`, {
          animations: "disabled",
        });
      });
    }
  });

  test.describe(`Details with fees, a short option, a credits swap and custom slippage at ${viewport.width} x ${viewport.height}`, () => {
    test.use({ viewport });

    for (const theme of THEMES) {
      test(`shows every new row whole inside the body, in the ${theme} theme`, async ({ page }) => {
        const dialog = await openPopup(
          page,
          `theme=${theme}&fee=3000&short=1&credits=enough&swapLoss=0.03&slippage=trade:300,credits:50`,
        );
        const head = dialog.getByTestId("predict-summary").getByRole("button").first();
        await head.click();
        await settle(dialog);

        await expect(head).toHaveText(/^2 markets move · 2 stop short$/);
        const rows = [
          dialog.getByTestId("credits-swap"),
          dialog.getByTestId("credits-loss"),
          dialog.getByTestId("stops-short").first(),
          dialog
            .getByRole("listitem")
            .filter({ hasText: /^Pool fees/ })
            .first(),
          dialog.getByTestId("fees-total"),
          ...(await dialog.getByTestId("slippage-row").all()),
        ];
        for (const row of rows) {
          await row.scrollIntoViewIfNeeded();
          expect.soft(await isWhole(row), (await row.textContent()) ?? "").toBe(true);
        }
        await expect(dialog.getByTestId("slippage-row")).toHaveText(["Max slippage3%", "Credits swap slippage0.5%"]);
        await dialog.getByTestId("stops-short").first().scrollIntoViewIfNeeded();
        await expect(page).toHaveScreenshot(`details-${viewport.width}x${viewport.height}-${theme}.png`, {
          animations: "disabled",
        });
      });
    }
  });
}
