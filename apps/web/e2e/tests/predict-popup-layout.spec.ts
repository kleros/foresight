import { expect, test, type Locator, type Page } from "@playwright/test";

import { startHarness } from "../utils/component-harness";

const STEPS = ["Create a trade wallet", "Add funds to your trade wallet", "Make prediction"];
/** Every point of a run the harness can render; `?state=` in e2e/harness/predict-popup/main.tsx. */
const STATES = [
  "idle",
  "quoting",
  "signing",
  "confirming",
  "failed",
  "pending",
  "success",
  "recovered",
  "over",
  "disconnected",
] as const;
/** Every PredictFailureReason, plus "fee": funds short after money moved. */
const FAILURE_REASONS = [
  "fee",
  "rejected",
  "cancelled",
  "reverted",
  "rpc",
  "unknown",
  "no-route",
  "quote",
  "funds",
  "balance",
  "deposit-unconfirmed",
  "wrong-wallet",
  "wrong-chain",
];
const VIEWPORTS = [
  { width: 375, height: 812 },
  { width: 375, height: 667 },
  { width: 820, height: 1180 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
];
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

async function openPopup(page: Page, options: number, state: (typeof STATES)[number] = "idle", reason?: string) {
  await page.goto(`${harness.url}?options=${options}&state=${state}${reason ? `&reason=${reason}` : ""}`);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--fs-accent"));
  expect(accent.trim(), "the harness loads Foresight's token layer").not.toBe("");
  await expect(
    dialog.getByRole("listitem").filter({ has: page.getByRole("img", { name: /the market$/ }) }),
  ).toHaveCount(options);
  return dialog;
}

/** The boxes a state change must not move: the dialog, its footer, and the scrolled body's full height. */
async function footprint(page: Page, dialog: Locator) {
  const box = (await dialog.boundingBox())!;
  const cancel = (await dialog.getByRole("button", { name: "Cancel" }).boundingBox())!;
  const body = await page.getByTestId("predict-body").evaluate((element) => element.getBoundingClientRect().height);
  const bullet = (await dialog.locator("[data-bullet]").first().boundingBox())!;
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    dialog: [box.x, box.y, box.width, box.height].map(round),
    footer: [cancel.x, cancel.y].map(round),
    body: round(body),
    steps: round(bullet.x),
  };
}

for (const height of [812, 667]) {
  for (const options of [2, 5]) {
    test.describe(`a ${options}-option popup at 375 x ${height}`, () => {
      test.use({ viewport: { width: 375, height } });

      test("keeps side margins, shows every step above the sticky bar and each estimate", async ({
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
          await step.evaluate((element) => element.scrollIntoView({ block: "nearest" }));
          expect.soft(await isFullyShown(step), `"${title}" is shown once scrolled to`).toBe(true);
          const box = await step.boundingBox();
          expect
            .soft(box && box.y + box.height, `"${title}" ends above the Cancel/Predict bar`)
            .toBeLessThanOrEqual(barTop);
        }

        const rows = dialog.getByRole("listitem").filter({ has: page.getByRole("img", { name: /the market$/ }) });
        for (let index = 0; index < options; index++) {
          const row = rows.nth(index);
          await row.evaluate((element) => element.scrollIntoView({ block: "nearest" }));
          expect.soft(await isFullyShown(row), `estimate ${index + 1} is shown once scrolled to`).toBe(true);
          const move = row.getByTestId("estimate-move");
          expect
            .soft(
              await move.evaluate((element) => {
                const row = element.closest("li")!.getBoundingClientRect();
                const box = element.getBoundingClientRect();
                return element.scrollWidth <= element.clientWidth && box.left >= row.left && box.right <= row.right;
              }),
              `estimate ${index + 1}'s market move is shown whole`,
            )
            .toBe(true);
        }

        expect.soft(pageErrors, "page errors").toEqual([]);

        // A baseline is only ever taken of a layout that passes the checks above; Harman signs it off.
        if (testInfo.errors.length > 0) return;
        await page.evaluate(() =>
          document.querySelector('[data-testid="predict-body"]')?.parentElement?.scrollTo(0, 0),
        );
        await expect(page).toHaveScreenshot(`predict-popup-375x${height}-${options}-options.png`, {
          animations: "disabled",
          caret: "hide",
        });
      });
    });
  }
}

for (const viewport of VIEWPORTS) {
  test.describe(`the popup through a run at ${viewport.width} x ${viewport.height}`, () => {
    test.use({ viewport });

    test("keeps one footprint and its footer in place in every state, inside the window", async ({
      page,
    }, testInfo) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));

      const idle = await footprint(page, await openPopup(page, 2, "idle"));
      for (const state of STATES) {
        const dialog = await openPopup(page, 2, state);
        await testInfo.attach(`${viewport.width}x${viewport.height}-${state}`, {
          body: await page.screenshot(),
          contentType: "image/png",
        });

        expect.soft(await footprint(page, dialog), `${state} has the idle popup's footprint`).toEqual(idle);

        const box = (await dialog.boundingBox())!;
        expect.soft(box.x, `${state}: left edge in the window`).toBeGreaterThanOrEqual(0);
        expect.soft(box.x + box.width, `${state}: right edge in the window`).toBeLessThanOrEqual(viewport.width);
        expect.soft(box.y + box.height, `${state}: bottom edge in the window`).toBeLessThanOrEqual(viewport.height);

        // a run's form is locked, and the popup scrolls to its running or failed step instead
        const isEditable = state === "idle" || state === "over" || state === "disconnected";
        for (const control of isEditable
          ? [dialog.getByRole("button", { name: "Max" }), dialog.getByRole("button", { name: /sDAI/ })]
          : []) {
          expect.soft(await isFullyShown(control), `${state}: ${await control.textContent()} is reachable`).toBe(true);
        }
        if (isEditable) {
          const max = (await dialog.getByRole("button", { name: "Max" }).boundingBox())!;
          expect.soft(Math.min(max.width, max.height), `${state}: Max is a 44px target`).toBeGreaterThanOrEqual(44);
        }

        const status = dialog.getByRole("status");
        if ((await status.textContent())?.trim()) {
          expect.soft(await isFullyShown(status), `${state}: the status line is in view`).toBe(true);
        }
        expect
          .soft(
            await status.evaluate((element) => element.scrollHeight <= element.clientHeight + 1),
            `${state}: the status line fits its slot`,
          )
          .toBe(true);
      }
      expect.soft(pageErrors, "page errors").toEqual([]);

      if (testInfo.errors.length > 0 || viewport.width !== 1280) return;
      await openPopup(page, 2, "idle");
      await expect(page).toHaveScreenshot("predict-popup-1280x800-idle.png", { animations: "disabled", caret: "hide" });
    });
  });
}

test.describe("every failure at the narrowest popup", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("fits its words in the status slot without moving the footer", async ({ page }) => {
    const idle = await footprint(page, await openPopup(page, 2, "idle"));
    for (const reason of FAILURE_REASONS) {
      const dialog = await openPopup(page, 2, "failed", reason);

      expect.soft(await footprint(page, dialog), `${reason} has the idle popup's footprint`).toEqual(idle);
      expect
        .soft(
          await dialog.getByRole("status").evaluate((element) => element.scrollHeight <= element.clientHeight + 1),
          `${reason}: the status line fits its slot`,
        )
        .toBe(true);
    }
  });
});

test.describe("the popup's tones", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("draws a finished step in the success tone and a failure in the error text tone", async ({ page }) => {
    const dialog = await openPopup(page, 2, "failed");
    const color = (locator: Locator) => locator.evaluate((element) => getComputedStyle(element).color);

    // --fs-tone-success and --fs-tone-error-text in the light theme
    expect(await color(dialog.locator('[data-bullet="done"]').first())).toBe("rgb(0, 196, 43)");
    expect(await color(dialog.getByRole("status"))).toBe("rgb(196, 0, 42)");
  });
});

test.describe("the popup under reduced motion", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("keeps the running step still", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const dialog = await openPopup(page, 2, "signing");
    const animations = await dialog
      .locator("li")
      .evaluateAll((items) => items.map((item) => getComputedStyle(item).animationName));

    expect(animations.every((name) => name === "none")).toBe(true);
  });
});
