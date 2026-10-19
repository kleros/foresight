import { expect, test, type Locator, type Page } from "@playwright/test";

import { openHarness, startHarness } from "../utils/component-harness";

/** The windows and themes every new state is drawn in. */
const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 375, height: 667 },
];
const THEMES = ["light", "dark"] as const;
const TRADES_FIELD = "Max slippage on trades, custom percent";

let harness: Awaited<ReturnType<typeof startHarness>>;

test.beforeAll(async () => {
  harness = await startHarness("predict-popup");
});

test.afterAll(async () => {
  await harness?.close();
});

/** Opens the harness with `query`, `?` params of e2e/harness/predict-popup/main.tsx, once its entrances end. */
async function openPopup(page: Page, query: string) {
  await openHarness(page, `${harness.url}?options=2&${query}`);
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
        .filter((animation) => animation.timeline === document.timeline)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}

/** The boxes the settings must not move: the dialog and its button's place. */
async function footprint(dialog: Locator) {
  const round = (value: number) => Math.round(value * 10) / 10;
  const box = (await dialog.boundingBox())!;
  const button = (await dialog.locator(".predict-cta").boundingBox())!;
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

        await dialog.getByRole("button", { name: "Settings" }).click();
        await settle(dialog);

        expect(await footprint(dialog)).toEqual(before);
        await expect(dialog.getByRole("heading", { level: 2, name: "Settings" })).toBeVisible();
        for (const field of [TRADES_FIELD, "Max slippage on the credits swap, custom percent"]) {
          expect.soft(await isWhole(dialog.getByRole("textbox", { name: field })), field).toBe(true);
        }
        // the body is under the panel, covered and out of the focus order
        const predict = dialog.locator(".predict-cta");
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
        const dialog = await openPopup(page, `theme=${theme}&settings=open&slippage=trade:800,credits:50`);
        await dialog.getByRole("textbox", { name: TRADES_FIELD }).blur();
        await settle(dialog);

        await expect(page).toHaveScreenshot(`settings-${viewport.width}x${viewport.height}-${theme}.png`, {
          animations: "disabled",
        });
      });
    }
  });
}

test.describe("the settings by keyboard", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("open from the gear with Enter, reach each choice with Tab, and close on Escape back to the gear", async ({
    page,
  }) => {
    const dialog = await openPopup(page, "theme=light");
    const gear = dialog.getByRole("button", { name: "Settings" });

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
      .locator(".predict-settings")
      .evaluate((element) => [getComputedStyle(element).transform, getComputedStyle(element).filter]);
    expect(style).toEqual(["none", "none"]);
  });
});

for (const viewport of VIEWPORTS) {
  test.describe(`prices that moved at ${viewport.width} x ${viewport.height}`, () => {
    test.use({ viewport });

    for (const theme of THEMES) {
      test(`keep the popup's footprint, say so whole on the status line and ask to confirm, in the ${theme} theme`, async ({
        page,
      }) => {
        const idle = await footprint(await openPopup(page, `theme=${theme}`));
        const dialog = await openPopup(page, `theme=${theme}&state=moved`);

        expect(await footprint(dialog)).toEqual(idle);
        const status = dialog.getByRole("status");
        await expect(status).toHaveText("Prices moved on 1 estimate. Check the new figures, then confirm.");
        expect(await isWhole(status.locator("span"))).toBe(true);
        await expect(dialog.getByRole("button", { name: "Confirm new prices" })).toBeEnabled();
      });

      test(`name the changed move's figures before, in the ${theme} theme`, async ({ page }) => {
        const dialog = await openPopup(page, `theme=${theme}&state=moved`);
        await dialog.getByTestId("predict-summary").getByRole("button").click();
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
        const head = dialog.getByTestId("predict-summary").getByRole("button");
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
          ...(await dialog.getByTestId("custom-slippage").all()),
        ];
        for (const row of rows) {
          await row.scrollIntoViewIfNeeded();
          expect.soft(await isWhole(row), (await row.textContent()) ?? "").toBe(true);
        }
        await expect(dialog.getByTestId("custom-slippage")).toHaveText(["Max slippage3%", "Credits swap slippage0.5%"]);
        await dialog.getByTestId("stops-short").first().scrollIntoViewIfNeeded();
        await expect(page).toHaveScreenshot(`details-${viewport.width}x${viewport.height}-${theme}.png`, {
          animations: "disabled",
        });
      });
    }
  });
}
