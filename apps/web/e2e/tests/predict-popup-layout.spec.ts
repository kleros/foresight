import { expect, test, type Locator, type Page } from "@playwright/test";

import { openHarness, startHarness } from "../utils/component-harness";

const STEPS = ["Create a trade wallet", "Add funds", "Place prediction"];
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
  { width: 320, height: 568 },
  { width: 360, height: 640 },
  { width: 360, height: 740 },
  { width: 375, height: 812 },
  { width: 375, height: 667 },
  { width: 820, height: 1180 },
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  { width: 1366, height: 657 },
  { width: 1280, height: 800 },
];
const SIDE_MARGIN = 16;
/** Windows, or a window and an option count, too short for every step at rest, where the body scrolls with its cue. */
const SCROLLING = ["320x568", "360x640", "1366x657", "1280x720-10"];

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

    // a rounded corner is not part of the element, so its probe sits inside the curve
    const radius = parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
    const inset = Math.max(2, Math.min(radius, rect.width / 2, rect.height / 2));
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

async function openPopup(
  page: Page,
  options: number,
  state: (typeof STATES)[number] = "idle",
  reason?: string,
  extra = "",
) {
  await openHarness(
    page,
    `${harness.url}?options=${options}&state=${state}${reason ? `&reason=${reason}` : ""}${extra}`,
  );
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Close" })).toBeVisible();
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--fs-accent"));
  expect(accent.trim(), "the harness loads Foresight's token layer").not.toBe("");
  await expect(
    dialog.getByRole("listitem").filter({ has: page.getByRole("img", { name: /the market$/ }) }),
  ).toHaveCount(options);
  await settle(dialog);
  return dialog;
}

/** Opens the summary under the amount, as the visitor would, and waits for its entrance to finish. */
async function openSummary(dialog: Locator) {
  const head = dialog.getByTestId("predict-summary").getByRole("button");
  await head.click();
  await expect(head).toHaveAttribute("aria-expanded", "true");
  await dialog.page().mouse.move(0, 0);
  await settle(dialog);
}

/** Waits out every finite animation in the dialog. */
async function settle(dialog: Locator) {
  // a finished entrance leaves no transform behind to count as overflow; the running pulse never finishes
  await dialog.evaluate((element) =>
    Promise.all(
      element
        .getAnimations({ subtree: true })
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        // a transition retargeted mid-flight is cancelled, which rejects its promise
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}

/** The boxes a state change must not move: the dialog, its button, and the scrolled body's full height. */
async function footprint(page: Page, dialog: Locator) {
  const box = (await dialog.boundingBox())!;
  const button = (await dialog.locator(".predict-cta").boundingBox())!;
  const body = await page.getByTestId("predict-body").evaluate((element) => element.getBoundingClientRect().height);
  const bullet = (await dialog.locator("ol [data-bullet]").first().boundingBox())!;
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    dialog: [box.x, box.y, box.width, box.height].map(round),
    footer: [button.x, button.y, button.width, button.height].map(round),
    body: round(body),
    steps: round(bullet.x),
  };
}

for (const height of [812, 667]) {
  for (const options of [2, 10]) {
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

        const barTop = (await dialog.locator(".predict-cta").boundingBox())!.y;
        const cue = await dialog
          .getByTestId("more-below")
          .evaluate((element) =>
            getComputedStyle(element).opacity === "0" ? Infinity : element.getBoundingClientRect().top,
          );
        // the short-window rules exist for this: a phone at 375 x 667 opens with every step in view
        for (const title of height === 667 ? STEPS : []) {
          const step = dialog.getByText(title, { exact: true });
          expect.soft(await isFullyShown(step), `"${title}" is in view as the popup opens`).toBe(true);
          const box = await step.boundingBox();
          expect.soft(box && box.y + box.height, `"${title}" ends above the more-below cue`).toBeLessThanOrEqual(cue);
        }
        for (const title of STEPS) {
          const step = dialog.getByText(title, { exact: true });
          await step.evaluate((element) => element.scrollIntoView({ block: "nearest" }));
          expect.soft(await isFullyShown(step), `"${title}" is shown once scrolled to`).toBe(true);
          const box = await step.boundingBox();
          expect.soft(box && box.y + box.height, `"${title}" ends above the Predict bar`).toBeLessThanOrEqual(barTop);
        }

        const rows = dialog.getByRole("listitem").filter({ has: page.getByRole("img", { name: /the market$/ }) });
        for (let index = 0; index < options; index++) {
          const row = rows.nth(index);
          await row.evaluate((element) => element.scrollIntoView({ block: "nearest" }));
          expect.soft(await isFullyShown(row), `estimate ${index + 1} is shown once scrolled to`).toBe(true);
        }

        // each estimate's market move is in the summary, shown whole once it is open
        await openSummary(dialog);
        const moves = dialog.getByTestId("market-move");
        await expect.soft(moves).toHaveCount(options);
        for (let index = 0; index < options; index++) {
          const move = moves.nth(index);
          await move.evaluate((element) => element.scrollIntoView({ block: "nearest" }));
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
        await openPopup(page, options);

        expect.soft(pageErrors, "page errors").toEqual([]);

        // A baseline is only ever taken of a layout that passes the checks above; Harman signs it off.
        if (testInfo.errors.length > 0) return;
        // the estimate list and the body each scroll; the baseline is both at rest
        await dialog.evaluate((element) => element.querySelectorAll("*").forEach((child) => child.scrollTo(0, 0)));
        await expect(page).toHaveScreenshot(`predict-popup-375x${height}-${options}-options.png`, {
          animations: "disabled",
          caret: "hide",
        });
      });
    });
  }
}

for (const viewport of VIEWPORTS) {
  for (const options of [2, 10]) {
    test.describe(`the ${options}-estimate popup through a run at ${viewport.width} x ${viewport.height}`, () => {
      test.use({ viewport });

      test("keeps one footprint and its button in place in every state, summary open or closed, inside the window", async ({
        page,
      }, testInfo) => {
        const pageErrors: string[] = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));

        const idleDialog = await openPopup(page, options, "idle");
        const idle = await footprint(page, idleDialog);
        // the popup fits the window: every step is in view as the popup opens, with nothing to scroll to
        const size = `${viewport.width}x${viewport.height}`;
        for (const title of SCROLLING.includes(size) || SCROLLING.includes(`${size}-${options}`) ? [] : STEPS) {
          expect
            .soft(await isFullyShown(idleDialog.getByText(title, { exact: true })), `"${title}" is in view at open`)
            .toBe(true);
        }
        const returning = await openPopup(page, options, "idle", undefined, "&first=0");
        expect
          .soft(await footprint(page, returning), "a returning predictor has the idle popup's footprint")
          .toEqual(idle);
        for (const state of STATES) {
          const dialog = await openPopup(page, options, state);
          await testInfo.attach(`${viewport.width}x${viewport.height}-${options}-${state}`, {
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
            ? [
                ...(state === "disconnected" ? [] : [dialog.getByRole("button", { name: "Max" })]),
                dialog.getByRole("button", { name: /sDAI/ }),
              ]
            : []) {
            expect
              .soft(await isFullyShown(control), `${state}: ${await control.textContent()} is reachable`)
              .toBe(true);
          }
          if (state === "disconnected" || state === "recovered") {
            await expect.soft(dialog.getByRole("button", { name: "Max" }), `${state}: Max is not offered`).toBeHidden();
          }
          if (isEditable && state !== "disconnected") {
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

        // open, the summary adds its rows; every state then keeps the open idle popup's footprint
        await openSummary(await openPopup(page, options, "idle"));
        const idleOpen = await footprint(page, page.getByRole("dialog"));
        for (const [state, extra] of [...STATES.map((state) => [state, ""] as const), ["idle", "&first=0"] as const]) {
          const dialog = await openPopup(page, options, state, undefined, extra);
          await openSummary(dialog);
          expect.soft(await footprint(page, dialog), `${state}${extra} with the summary open`).toEqual(idleOpen);
        }
        expect.soft(pageErrors, "page errors").toEqual([]);

        if (testInfo.errors.length > 0 || size !== "1280x800" || options !== 2) return;
        await openPopup(page, 2, "idle");
        await expect(page).toHaveScreenshot("predict-popup-1280x800-idle.png", {
          animations: "disabled",
          caret: "hide",
        });
      });
    });
  }
}

test.describe("the popup's scroll area", () => {
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 375, height: 667 },
  ]) {
    test(`says there is more below until it is scrolled to the end at ${viewport.width} x ${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const dialog = await openPopup(page, 10);
      const scroller = page.getByTestId("predict-body").locator("..");
      const cue = dialog.getByTestId("more-below");
      const overflows = await scroller.evaluate((element) => element.scrollHeight > element.clientHeight);

      if (overflows) {
        await expect(cue).toHaveCSS("opacity", "1");
        expect(await cue.evaluate((element) => getComputedStyle(element).pointerEvents)).toBe("none");
        await scroller.evaluate((element) => element.scrollTo(0, element.scrollHeight));
      }
      await expect(cue).toHaveCSS("opacity", "0");
    });
  }

  // 360 x 716 leaves the body a few px short of its steps
  for (const viewport of [
    { width: 360, height: 640 },
    { width: 360, height: 716 },
    { width: 360, height: 740 },
    { width: 320, height: 568 },
  ]) {
    for (const options of [2, 3, 10]) {
      test(`scrolls to a run's steps only where it said there was more below, ${options} estimates at ${viewport.width} x ${viewport.height}`, async ({
        page,
      }) => {
        await page.setViewportSize(viewport);
        const idle = await openPopup(page, options);
        const scroller = page.getByTestId("predict-body").locator("..");
        const cued =
          (await idle.getByTestId("more-below").evaluate((element) => getComputedStyle(element).opacity)) === "1";
        const canScroll = await scroller.evaluate((element) => element.scrollHeight > element.clientHeight);
        expect.soft(canScroll, "the body scrolls only with its cue").toBe(cued);

        const titleTop = async () => (await page.getByText("You pay", { exact: true }).boundingBox())!.y;
        const atRest = await titleTop();
        await openPopup(page, options, "signing");
        if (!cued) {
          expect
            .soft(await scroller.evaluate((element) => element.scrollTop), "the body's scroll once signing")
            .toBe(0);
          expect.soft(await titleTop(), "the amount's title once signing").toBe(atRest);
        }
      });
    }
  }

  for (const [width, height, options] of [
    [320, 568, 2],
    [360, 640, 10],
    [1366, 657, 10],
  ] as const) {
    for (const state of ["signing", "failed"] as const) {
      test(`opens ${state} with its steps' foot at the body's foot, ${options} estimates at ${width} x ${height}`, async ({
        page,
      }) => {
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.setViewportSize({ width, height });
        await openPopup(page, options, state);
        const scroller = await page.getByTestId("predict-body").locator("..").boundingBox();
        const steps = await page.locator(".predict-steps").boundingBox();

        expect(steps!.y + steps!.height).toBeLessThanOrEqual(scroller!.y + scroller!.height + 1);
      });
    }
  }

  for (const width of [320, 360, 375]) {
    for (const options of [2, 3, 10]) {
      test(`lays its cue over no step at any phone height, ${options} estimates at ${width} wide`, async ({ page }) => {
        await page.setViewportSize({ width, height: 812 });
        const dialog = await openPopup(page, options);
        const scroller = page.getByTestId("predict-body").locator("..");
        const cue = dialog.getByTestId("more-below");
        const titles = STEPS.map((title) => dialog.getByText(title, { exact: true }));

        // every height from 560 to 812, 360 x 712 and 320 x 640 among them
        for (let height = 560; height <= 812; height += 2) {
          await page.setViewportSize({ width, height });
          await page.evaluate(
            () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          );
          await scroller.evaluate((element) => element.scrollTo(0, 0));
          await page.evaluate(
            () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          );

          const canScroll = await scroller.evaluate((element) => element.scrollHeight > element.clientHeight);
          const cueBox = await cue.evaluate((element) =>
            element.classList.contains("opacity-0") ? null : element.getBoundingClientRect().toJSON(),
          );
          expect
            .soft(cueBox !== null, `${width} x ${height}: the cue shows exactly when the body scrolls`)
            .toBe(canScroll);
          if (!cueBox) continue;
          const view = (await scroller.boundingBox())!;
          for (const [index, title] of titles.entries()) {
            const box = (await title.boundingBox())!;
            // only the part the scroll area shows can be painted over
            const top = Math.max(box.y, view.y);
            const bottom = Math.min(box.y + box.height, view.y + view.height);
            const overlaps = top < bottom && top < cueBox.bottom && bottom > cueBox.top;
            expect.soft(overlaps, `${width} x ${height}: the cue lies over "${STEPS[index]}"`).toBe(false);
          }
        }
      });
    }
  }

  // the cut row and its fade say there is more, on a phone too; four rows on a wide popup would overflow by a fade's worth for nothing
  for (const [width, height, options, rows] of [
    [1280, 800, 10, 3.5],
    [1280, 800, 4, 4],
    [375, 667, 10, 2.5],
    [360, 740, 4, 2.5],
    [375, 667, 3, 3],
  ] as const) {
    test(`shows ${rows} estimate rows of ${options} at ${width} x ${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const dialog = await openPopup(page, options);
      const list = dialog.getByRole("list").first();
      const [box, row] = await Promise.all([
        list.locator("..").boundingBox(),
        list.getByRole("listitem").first().boundingBox(),
      ]);

      expect(box!.height / row!.height).toBeCloseTo(rows, 1);
      if (!Number.isInteger(rows)) {
        // the cut row lies wholly under the fade, which reaches the panel's tone at the edge, so no glyph shows a hard cut
        const fade = (await list.locator("xpath=../following-sibling::div[1]").boundingBox())!;
        expect(fade.height).toBeGreaterThanOrEqual(row!.height);
      }
    });
  }

  test("fades a whole step row over the body's foot while it scrolls, so no bullet shows cut", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    const dialog = await openPopup(page, 10, "idle", undefined, "&first=0");
    await dialog.getByRole("button", { name: /markets? move|Market prices/ }).click();
    await settle(dialog);
    const body = page.getByTestId("predict-body");
    const fade = body.locator("xpath=../following-sibling::div[1]");

    await expect(fade).toBeVisible();
    expect((await fade.boundingBox())!.height).toBeGreaterThanOrEqual(40);
  });
});

for (const viewport of [
  { width: 375, height: 667 },
  { width: 360, height: 640 },
]) {
  test.describe(`a popup on a short screen at ${viewport.width} x ${viewport.height}`, () => {
    test.use({ viewport });

    test("leaves out the share slider and keeps a two-line status slot", async ({ page }) => {
      const dialog = await openPopup(page, 2, "failed", "funds");

      await expect(dialog.getByTestId("amount-slider")).toBeHidden();
      expect((await dialog.getByRole("status").boundingBox())!.height).toBeLessThanOrEqual(40);
    });
  });
}

for (const viewport of [
  { width: 1024, height: 720 },
  { width: 1280, height: 720 },
  { width: 1366, height: 657 },
  { width: 1440, height: 760 },
]) {
  test.describe(`a popup in a short desktop window at ${viewport.width} x ${viewport.height}`, () => {
    test.use({ viewport });

    test("keeps the share slider and the full-height button, which only a phone gives up", async ({ page }) => {
      const dialog = await openPopup(page, 2);

      await expect(dialog.getByTestId("amount-slider")).toBeVisible();
      expect((await dialog.locator(".predict-cta").boundingBox())!.height).toBe(52);
    });
  });
}

for (const viewport of [
  { width: 375, height: 667 },
  { width: 360, height: 640 },
  { width: 320, height: 568 },
]) {
  test.describe(`every failure at ${viewport.width} x ${viewport.height}`, () => {
    test.use({ viewport });

    test("fits its words in a two-line status slot, left-aligned under the title, without moving the footer", async ({
      page,
    }) => {
      const idle = await footprint(page, await openPopup(page, 10, "idle"));
      for (const reason of FAILURE_REASONS) {
        const dialog = await openPopup(page, 10, "failed", reason);
        const status = dialog.getByRole("status");
        const [text, title] = await Promise.all([
          status.locator("span").boundingBox(),
          dialog.getByRole("heading", { name: "Predict", exact: true }).boundingBox(),
        ]);

        expect.soft(await status.evaluate((element) => getComputedStyle(element).textAlign), reason).toBe("left");
        expect.soft(Math.abs(text!.x - title!.x), `${reason} starts under the title`).toBeLessThanOrEqual(1);
        expect.soft((await status.boundingBox())!.height, `${reason}: a two-line slot`).toBeLessThanOrEqual(40);

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
}

for (const viewport of [
  { width: 844, height: 390 },
  { width: 667, height: 375 },
  { width: 568, height: 320 },
]) {
  test.describe(`a landscape phone at ${viewport.width} x ${viewport.height}`, () => {
    test.use({ viewport });

    for (const state of ["idle", "failed"] as const) {
      test(`keeps the button inside the dialog and every part reachable above it, ${state}`, async ({ page }) => {
        const dialog = await openPopup(page, 10, state);
        const box = (await dialog.boundingBox())!;
        const button = dialog.locator(".predict-cta");
        const buttonBox = (await button.boundingBox())!;
        expect(buttonBox.y + buttonBox.height, "the button's foot").toBeLessThanOrEqual(box.y + box.height);

        for (const part of [
          dialog.locator('[data-panel="amount"]'),
          dialog.getByTestId("predict-summary"),
          ...(await dialog.locator(".predict-steps > li").all()),
          dialog.getByRole("status"),
        ]) {
          await part.evaluate((element) => element.scrollIntoView({ block: "nearest" }));
          const partBox = (await part.boundingBox())!;
          expect(partBox.y + partBox.height, "a part's foot above the button").toBeLessThanOrEqual(
            (await button.boundingBox())!.y + 1,
          );
          expect(partBox.y, "a part's top inside the dialog").toBeGreaterThanOrEqual(box.y);
        }
      });
    }
  });
}

test.describe("an amount over a four-digit balance at 375 x 812", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("shows the balance and its token whole, and keeps the slider's thumb on the track at 100%", async ({ page }) => {
    await openHarness(page, `${harness.url}?options=2&state=over&held=6833.959612`);
    const dialog = page.getByRole("dialog");
    const summary = dialog.getByText(/^Not enough balance/);

    await expect(summary).toContainText("6,839.9596 sDAI");
    // inside its held slot, so the body keeps the idle popup's height
    expect(
      await summary.evaluate(
        (element) => element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight,
      ),
    ).toBe(true);
    expect(await isFullyShown(summary)).toBe(true);

    await expect(dialog.getByTestId("amount-share")).toHaveText("100%");
    const slider = dialog.getByTestId("amount-slider");
    const [thumb, row] = await Promise.all([
      slider.locator("div:has(>#slider-label)").boundingBox(),
      slider.boundingBox(),
    ]);
    expect(thumb!.x).toBeGreaterThanOrEqual(row!.x);
    expect(thumb!.x + thumb!.width).toBeLessThanOrEqual(row!.x + row!.width);
  });
});

test.describe("an amount over the balance", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("tints its digits in the error tone, with no status icon beside them", async ({ page }) => {
    const dialog = await openPopup(page, 2, "over");
    const input = dialog.getByLabel("Amount");
    const errorTone = await input.evaluate((element) => {
      const probe = document.createElement("span");
      probe.style.color = "var(--fs-tone-error-text)";
      element.parentElement!.append(probe);
      const tone = getComputedStyle(probe).color;
      probe.remove();
      return tone;
    });

    await expect(input).toHaveCSS("color", errorTone);
    await expect(dialog.getByTestId("amount-input").locator(".input-wrapper > svg")).toBeHidden();
  });
});

test.describe("the amount panel's controls", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("round Max's focus ring to the panel's corners and draw the token's caret as a 1.5px chevron", async ({
    page,
  }) => {
    const dialog = await openPopup(page, 2, "idle", undefined, "&tokens=2");
    const token = dialog.getByRole("button", { name: /sDAI/ });

    await expect(dialog.getByRole("button", { name: "Max" })).toHaveCSS("border-top-left-radius", "6px");
    await expect(token.locator("> svg").last()).toBeHidden();
    expect(
      await token.evaluate((button) => {
        const caret = getComputedStyle(button, "::after");
        return [caret.content, caret.width, caret.maskImage.startsWith("url(")];
      }),
    ).toEqual(['""', "14px", true]);
  });
});

test.describe("a single pay token", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("draws no caret on a token select that cannot open", async ({ page }) => {
    const dialog = await openPopup(page, 2);
    const token = dialog.getByRole("button", { name: /sDAI/ });

    await expect(token).toBeDisabled();
    expect(await token.evaluate((button) => getComputedStyle(button, "::after").display)).toBe("none");
    // the pill's ends hold the same space, icon to its left edge and label to its right
    const [left, right] = await token.evaluate((button) => {
      const box = button.getBoundingClientRect();
      const icon = button.querySelector("svg")!.getBoundingClientRect();
      const text = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
      let label = 0;
      for (let node = text.nextNode(); node; node = text.nextNode()) {
        const range = document.createRange();
        range.selectNodeContents(node);
        label = Math.max(label, range.getBoundingClientRect().right);
      }
      return [icon.left - box.left, box.right - label];
    });
    expect(right).toBeCloseTo(left, 0);
  });
});

test.describe("a balance that wraps under the amount's title", () => {
  for (const viewport of [
    { width: 360, height: 640 },
    { width: 375, height: 667 },
    { width: 414, height: 896 },
    { width: 520, height: 900 },
    { width: 640, height: 900 },
    { width: 1280, height: 800 },
  ]) {
    for (const held of ["1234.5678", "12345678.9", "98765432109.12345"]) {
      test(`keeps one footprint across states with ${held} held at ${viewport.width} x ${viewport.height}`, async ({
        page,
      }) => {
        await page.setViewportSize(viewport);
        const idleDialog = await openPopup(page, 2, "idle", undefined, `&held=${held}`);
        const idle = await footprint(page, idleDialog);
        const [title, balance] = await Promise.all([
          idleDialog.locator('[data-panel="amount"] h3').boundingBox(),
          idleDialog.getByTestId("balance-figure").boundingBox(),
        ]);
        // under 375px the row always wraps; wider, a disconnected row has no balance to wrap, so it matches only an unwrapped one
        const wraps = balance!.y > title!.y + title!.height - 1;
        const states =
          wraps && viewport.width >= 375
            ? (["idle", "recovered"] as const)
            : (["idle", "recovered", "disconnected"] as const);
        for (const state of states) {
          for (const first of ["1", "0"]) {
            const dialog = await openPopup(page, 2, state, undefined, `&held=${held}&first=${first}`);
            expect.soft(await footprint(page, dialog), `${state}, first=${first}`).toEqual(idle);
          }
        }
      });
    }
  }
});

test.describe("the amount's title and balance on a narrow screen", () => {
  for (const { width, height, query } of [
    { width: 375, height: 812, query: "options=2&first=0&held=6833.959612" },
    { width: 320, height: 568, query: "options=2&first=0&held=6833.959612" },
    { width: 320, height: 568, query: "options=10&held=98765432109.12345" },
  ]) {
    test.describe(`${query} at ${width} x ${height}`, () => {
      test.use({ viewport: { width, height } });

      test("shows the title whole, Max whole, and the balance inside the dialog", async ({ page }) => {
        await openHarness(page, `${harness.url}?${query}`);
        const dialog = page.getByRole("dialog");
        const node = dialog.locator('[data-panel="amount"]');
        const title = node.locator("h3");
        await expect(title).toBeVisible();

        expect(await title.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
        expect(await isFullyShown(dialog.getByRole("button", { name: "Max" }))).toBe(true);
        const balance = node.getByText(/^Balance: /);
        const [balanceBox, dialogBox] = [(await balance.boundingBox())!, (await dialog.boundingBox())!];
        expect(balanceBox.x + balanceBox.width).toBeLessThanOrEqual(dialogBox.x + dialogBox.width);
      });
    });
  }
});

test.describe("the amount's balance", () => {
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 360, height: 640 },
    { width: 360, height: 740 },
    { width: 375, height: 667 },
    { width: 375, height: 812 },
  ]) {
    for (const held of ["1234.5678", "6833.959612", "98765432109.12345"]) {
      for (const first of ["1", "0"]) {
        test(`shows ${held} and its token whole under ${first === "1" ? "You pay" : "Extra funds"} at ${viewport.width} x ${viewport.height}`, async ({
          page,
        }) => {
          await page.setViewportSize(viewport);
          const dialog = await openPopup(page, 2, "idle", undefined, `&held=${held}&first=${first}`);
          const figure = dialog.getByTestId("balance-figure");
          await expect(figure).toHaveText(/^[\d,.]+ sDAI$/);
          expect(await figure.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
          expect(await isFullyShown(figure)).toBe(true);
          // only a figure too long for the line gives up the label
          if (held !== "98765432109.12345") {
            expect(await isFullyShown(dialog.getByText("Balance:", { exact: true }))).toBe(true);
          }
        });
      }
    }
  }

  test.describe("at 320 x 568, disconnected", () => {
    test.use({ viewport: { width: 320, height: 568 } });

    test("says no wallet is connected in full", async ({ page }) => {
      const dialog = await openPopup(page, 2, "disconnected");
      const figure = dialog.getByTestId("balance-figure");
      await expect(figure).toHaveText("No wallet connected");
      expect(await figure.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    });
  });

  test.describe("at 375 x 812", () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test("sits on the title's line when it fits there", async ({ page }) => {
      const dialog = await openPopup(page, 2);
      const [title, balance] = await Promise.all([
        dialog.locator('[data-panel="amount"] h3').boundingBox(),
        dialog.getByText(/^Balance: /).boundingBox(),
      ]);
      expect(Math.abs(title!.y + title!.height / 2 - (balance!.y + balance!.height / 2))).toBeLessThanOrEqual(1);
    });
  });
});

test.describe("a locked share slider", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("keeps its percent beside the track", async ({ page }) => {
    const dialog = await openPopup(page, 2, "signing");

    await expect(dialog.getByTestId("amount-share")).toBeVisible();
    await expect(dialog.getByTestId("amount-share")).toHaveText(/^\d+%$/);
  });
});

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 375, height: 812 },
]) {
  test.describe(`the share slider at ${viewport.width} x ${viewport.height}`, () => {
    test.use({ viewport });

    test("is a 16px row with no floating label, and a 44px hit area between the summary and the steps", async ({
      page,
    }) => {
      const dialog = await openPopup(page, 2, "idle");
      const slider = dialog.getByTestId("amount-slider");
      const summary = dialog.getByTestId("amount-input").locator("xpath=following-sibling::p[1]");
      const [row, hit, above, below] = await Promise.all([
        slider.boundingBox(),
        slider.locator("div:has(>#slider-track)").boundingBox(),
        summary.boundingBox(),
        dialog.getByText("Create a trade wallet", { exact: true }).boundingBox(),
      ]);

      expect(row!.height).toBe(16);
      expect(hit!.height).toBeGreaterThanOrEqual(44);
      expect(hit!.y).toBeGreaterThanOrEqual(above!.y + above!.height);
      expect(hit!.y + hit!.height).toBeLessThanOrEqual(below!.y);
      await expect(slider.locator("#slider-label")).toBeHidden();
    });
  });
}

test.describe("the header's close button", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("cannot be pressed while a run goes, and can at rest and after a stop", async ({ page }) => {
    for (const state of STATES) {
      const close = (await openPopup(page, 2, state)).getByRole("button", { name: "Close" });
      const running = state === "quoting" || state === "signing" || state === "confirming";
      if (running) await expect.soft(close, state).toBeDisabled();
      else await expect.soft(close, state).toBeEnabled();
      // a 44px target round its 32px circle
      const box = (await close.boundingBox())!;
      expect.soft(Math.min(box.width, box.height) + 12, `${state}: its target`).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe("the popup opening focused", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("draws no focus ring round the container it focuses itself", async ({ page }) => {
    await openPopup(page, 2, "idle");
    const focused = await page.evaluate(() => {
      const element = document.activeElement!;
      return {
        tabIndex: element.getAttribute("tabindex"),
        focusVisible: element.matches(":focus-visible"),
        outline: getComputedStyle(element).outlineStyle,
      };
    });

    expect(focused).toEqual({ tabIndex: "-1", focusVisible: true, outline: "none" });
  });

  test("keeps the ring on a control reached by keyboard", async ({ page }) => {
    const dialog = await openPopup(page, 2, "idle");
    await page.keyboard.press("Tab");
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);

    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    expect(outline).toBe("solid");
  });
});

test.describe("the amount field reached by keyboard", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("rings the amount panel, inside its edge, while the field has the focus", async ({ page }) => {
    const dialog = await openPopup(page, 2, "idle");
    const panel = dialog.locator('[data-panel="amount"]');
    const input = dialog.getByTestId("amount-input").locator("input");
    const shadow = () => panel.evaluate((element) => getComputedStyle(element).boxShadow);
    const [atRest, box] = [await shadow(), await panel.boundingBox()];

    for (let step = 0; step < 12 && !(await input.evaluate((element) => element === document.activeElement)); step++) {
      await page.keyboard.press("Tab");
    }
    await expect(input).toBeFocused();

    expect(await shadow()).not.toBe(atRest);
    expect(await shadow()).toContain("inset");
    expect(await panel.boundingBox()).toEqual(box);
  });
});

test.describe("the popup's tones", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("checks a finished step on the axis and says a failure in the error text tone", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const dialog = await openPopup(page, 2, "failed");
    const done = dialog.locator('[data-bullet="done"]').first();

    // --fs-popup-on-axis over the bullet's axis fill, and --fs-tone-error-text, in the light theme
    expect(await done.locator('[data-glyph="check"]').evaluate((glyph) => getComputedStyle(glyph).color)).toBe(
      "rgb(255, 255, 255)",
    );
    expect(await done.evaluate((bullet) => getComputedStyle(bullet, "::before").opacity)).toBe("1");
    expect(await dialog.getByRole("status").evaluate((status) => getComputedStyle(status).color)).toBe(
      "rgb(196, 0, 42)",
    );
  });
});

test.describe("the running step", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("pulses its bullet, not its words, and the status line stays empty", async ({ page }) => {
    const dialog = await openPopup(page, 2, "signing");
    const running = dialog.locator("li").filter({ has: page.locator('[data-bullet="running"]') });
    const animationOf = (element: Locator) => element.evaluate((node) => getComputedStyle(node).animationName);

    expect(await animationOf(dialog.locator('[data-bullet="running"]'))).toBe("loading");
    expect(await animationOf(running)).toBe("none");
    await expect(dialog.getByRole("status")).toHaveText("");
  });
});

test.describe("the popup under reduced motion", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  for (const state of ["signing", "quoting"] as const) {
    test(`keeps the running step, the busy button and the price check still while ${state}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      const dialog = await openPopup(page, 2, state);
      // a ring that cannot turn reads as a stray glyph, so the busy label stands alone
      await expect(dialog.getByTestId("predict-spinner")).toBeHidden();
      await expect(dialog.locator(".predict-cta")).toHaveAttribute("data-busy");
      const animations = await dialog
        .locator("li, li *, button svg, [data-testid=predict-spinner], [data-testid=pricing-sweep] *")
        .evaluateAll((items) => items.map((item) => getComputedStyle(item).animationName));

      expect(animations.every((name) => name === "none")).toBe(true);
    });
  }
});

test.describe("a disabled Predict", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  /** The button's fill as 0-255 channels and its white label's contrast on it. */
  const readFill = (predict: Locator) =>
    predict.evaluate((button) => {
      const numbers = (css: string) => css.match(/[\d.]+/g)!.map(Number);
      // a color-mix() fill computes to color(srgb r g b / a), channels 0-1
      const css = getComputedStyle(button).backgroundColor;
      const [r = 0, g = 0, b = 0, alpha = 1] = css.startsWith("color(")
        ? numbers(css).map((n, i) => (i < 3 ? n * 255 : n))
        : numbers(css);
      const linear = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      const luminance = ([x = 0, y = 0, z = 0]: number[]) =>
        0.2126 * linear(x) + 0.7152 * linear(y) + 0.0722 * linear(z);
      const label = numbers(getComputedStyle(button.querySelector(".button-text")!).color).slice(0, 3);
      const [fill, text] = [luminance([r, g, b]), luminance(label)];
      return {
        fill: [r, g, b].map(Math.round),
        alpha,
        opacity: Number(getComputedStyle(button).opacity),
        ratio: (Math.max(fill, text) + 0.05) / (Math.min(fill, text) + 0.05),
      };
    });

  // --fs-popup-cta-disabled in each theme
  for (const [theme, fill] of [
    ["light", [235, 232, 244]],
    ["dark", [46, 32, 108]],
  ] as const) {
    test(`is the muted panel tone with its label at 4.5:1 or more in the ${theme} theme`, async ({ page }) => {
      await openHarness(page, `${harness.url}?options=2&state=over&theme=${theme}`);
      const predict = page.getByRole("dialog").getByRole("button", { name: "Predict" });
      await expect(predict).toBeDisabled();

      const shown = await readFill(predict);
      expect(shown.alpha).toBe(1);
      expect(shown.opacity).toBe(1);
      shown.fill.forEach((channel, index) => expect.soft(Math.abs(channel - fill[index]!)).toBeLessThanOrEqual(2));
      expect(shown.ratio).toBeGreaterThanOrEqual(4.5);
    });
  }

  test("dims Max to the tertiary text while it cannot be pressed", async ({ page }) => {
    const dialog = await openPopup(page, 2, "signing");
    const max = dialog.getByRole("button", { name: "Max" });
    await expect(max).toBeDisabled();

    const [label, secondary] = await Promise.all([
      max.locator(".button-text").evaluate((element) => getComputedStyle(element).color),
      dialog.evaluate((element) => {
        const probe = element.ownerDocument.createElement("span");
        probe.className = "text-fs-popup-text-3";
        element.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      }),
    ]);
    expect(label).toBe(secondary);
  });
});

test.describe("accent text in the dark theme", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("reads at AA on the dialog's surface", async ({ page }) => {
    await openHarness(page, `${harness.url}?options=2&state=idle&theme=dark`);
    const max = page.getByRole("dialog").getByRole("button", { name: "Max" }).locator(".button-text");

    const ratio = await max.evaluate((label) => {
      const channels = (css: string) =>
        css
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map((n) => Number(n) / 255);
      const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      const luminance = ([r = 0, g = 0, b = 0]: number[]) =>
        0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
      const text = luminance(channels(getComputedStyle(label).color));
      const surface = luminance(channels(getComputedStyle(label.closest("section")!).backgroundColor));
      return (Math.max(text, surface) + 0.05) / (Math.min(text, surface) + 0.05);
    });

    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});

test.describe("the steps' connector", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  /** The axis fill over each dotted connector, top to bottom: true where it is drawn. */
  const fills = (dialog: Locator) =>
    dialog
      .locator(".predict-steps > li > div:first-child > div:last-child:not([style])")
      .evaluateAll((lines) =>
        lines.map((line) => getComputedStyle(line, "::after").transform === "matrix(1, 0, 0, 1, 0, 0)"),
      );

  test("is dotted and unfilled at rest, and fills under each step that has finished", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const idle = await openPopup(page, 2, "idle");
    expect(await fills(idle)).toEqual([false, false]);
    expect(
      await idle
        .locator(".predict-steps > li > div:first-child > div:last-child:not([style])")
        .first()
        .evaluate((line) => getComputedStyle(line).borderLeftStyle),
    ).toBe("dotted");

    // the trade wallet is done; adding funds is running
    expect(await fills(await openPopup(page, 2, "signing"))).toEqual([true, false]);
  });

  test("runs from one bullet to the next", async ({ page }) => {
    const dialog = await openPopup(page, 2, "idle");
    const [bullets, lines] = await Promise.all([
      dialog
        .locator(".predict-steps [data-bullet]")
        .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect())),
      dialog
        .locator(".predict-steps > li > div:first-child > div:last-child:not([style])")
        .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect())),
    ]);

    for (const [index, line] of lines.entries()) {
      expect(line.top, `connector ${index + 1}'s top`).toBeCloseTo(bullets[index]!.bottom, 0);
      expect(line.bottom, `connector ${index + 1}'s foot`).toBeCloseTo(bullets[index + 1]!.top, 0);
    }
  });

  test("numbers a step until it finishes or fails, then shows the check or the cross alone", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const shown = (dialog: Locator, view: string) =>
      dialog
        .locator(`[data-bullet="${view}"]`)
        .first()
        .locator("[data-glyph]")
        .evaluateAll((glyphs) =>
          glyphs
            .filter((glyph) => getComputedStyle(glyph).opacity === "1")
            .map((glyph) => (glyph as HTMLElement).dataset.glyph),
        );

    const idle = await openPopup(page, 2, "idle");
    expect(await shown(idle, "idle")).toEqual(["digit"]);
    const failed = await openPopup(page, 2, "failed");
    expect(await shown(failed, "done")).toEqual(["check"]);
    expect(await shown(failed, "failed")).toEqual(["cross"]);
  });
});

for (const width of [375, 320, 1280]) {
  test.describe(`a step row at ${width} wide`, () => {
    test.use({ viewport: { width, height: 812 } });

    test("centres its bullet on its title, with a detail or without, and its connector runs bullet to bullet", async ({
      page,
    }) => {
      const dialog = await openPopup(page, 2, "failed");
      const rows = await dialog.locator(".predict-steps > li").evaluateAll((items) =>
        items.map((item) => {
          const bullet = item.querySelector("[data-bullet]")!.getBoundingClientRect();
          const title = item.querySelector("h2")!.getBoundingClientRect();
          const line = item
            .querySelector(":scope > div:first-child > div:last-child:not([style])")
            ?.getBoundingClientRect();
          return { bullet, title, line };
        }),
      );

      for (const [index, { bullet, title, line }] of rows.entries()) {
        expect(bullet.top + bullet.height / 2, `step ${index + 1}'s bullet`).toBeCloseTo(
          title.top + title.height / 2,
          0,
        );
        if (!line) continue;
        expect(line.top, `connector ${index + 1}'s top`).toBeCloseTo(bullet.bottom, 0);
        expect(line.bottom, `connector ${index + 1}'s foot`).toBeCloseTo(rows[index + 1]!.bullet.top, 0);
      }
    });
  });
}

test.describe("the popup's numbers", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("set the balance and the estimates count in tabular figures, through the type roles' font shorthand", async ({
    page,
  }) => {
    const dialog = await openPopup(page, 10);
    for (const number of [dialog.getByText(/^Balance:/), dialog.getByText(/^10 estimates$/)]) {
      await expect(number).toHaveCSS("font-variant-numeric", "tabular-nums");
    }
  });
});

test.describe("the summary opening and closing", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  /** Every running transition or animation in the summary: what it moves, how long, and after what delay. */
  const motion = (dialog: Locator) =>
    dialog.getByTestId("predict-summary").evaluate((summary) =>
      summary.getAnimations({ subtree: true }).map((animation) => ({
        name:
          animation instanceof CSSTransition
            ? animation.transitionProperty
            : animation instanceof CSSAnimation
              ? animation.animationName
              : "",
        duration: Number(animation.effect!.getTiming().duration),
        delay: animation.effect!.getTiming().delay ?? 0,
      })),
    );

  test("grows the body under the steps' feet as its rows fade in, then fades the rows before it folds", async ({
    page,
  }) => {
    const dialog = await openPopup(page, 2);
    const head = dialog.getByTestId("predict-summary").getByRole("button");
    const bulletTop = () =>
      dialog
        .locator("ol [data-bullet]")
        .first()
        .evaluate((bullet) => bullet.getBoundingClientRect().top);
    const closed = await bulletTop();

    await head.click();
    expect(await motion(dialog)).toEqual(
      expect.arrayContaining([
        { name: "grid-template-rows", duration: 250, delay: 0 },
        { name: "opacity", duration: 250, delay: 0 },
        { name: "transform", duration: 250, delay: 0 },
      ]),
    );
    // halfway, the steps are on their way down, not already there
    await dialog.evaluate((element) =>
      element.getAnimations({ subtree: true }).forEach((animation) => {
        animation.pause();
        animation.currentTime = 125;
      }),
    );
    const halfway = await bulletTop();
    await dialog.evaluate((element) =>
      element.getAnimations({ subtree: true }).forEach((animation) => animation.finish()),
    );
    const open = await bulletTop();
    expect(open - closed).toBeGreaterThan(40);
    expect(halfway).toBeGreaterThan(closed + 4);
    expect(halfway).toBeLessThan(open - 4);

    await head.click();
    expect(await motion(dialog)).toEqual(
      expect.arrayContaining([
        { name: "opacity", duration: 100, delay: 0 },
        { name: "transform", duration: 100, delay: 0 },
        { name: "grid-template-rows", duration: 250, delay: 100 },
      ]),
    );
    await settle(dialog);
    expect(await bulletTop()).toBeCloseTo(closed, 0);
  });
});

test.describe("a step's bullet", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("changes state by opacity and transform alone", async ({ page }) => {
    const dialog = await openPopup(page, 2, "signing");
    const properties = await dialog.locator("[data-bullet], [data-bullet] *").evaluateAll((nodes) =>
      nodes.flatMap((node) =>
        [null, "::before", "::after"].flatMap((pseudo) =>
          getComputedStyle(node, pseudo)
            .transitionProperty.split(", ")
            .filter((property) => property !== "all" || getComputedStyle(node, pseudo).transitionDuration !== "0s"),
        ),
      ),
    );

    expect([...new Set(properties)].sort()).toEqual(["opacity", "transform"]);
  });
});

/** Resolves a colour or length token to its computed value, through a probe in the page. */
function tokenValue(page: Page, property: "color" | "borderRadius", value: string) {
  return page.evaluate(
    ([property, value]) => {
      const probe = document.createElement("span");
      probe.style[property as "color"] = value;
      document.body.append(probe);
      const resolved = getComputedStyle(probe)[property as "color"];
      probe.remove();
      return resolved;
    },
    [property, value] as const,
  );
}

test.describe("the success dialog", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("draws the email in a field of the panel's tones", async ({ page }) => {
    await openHarness(page, `${harness.url}?options=2&state=success&dialog=success`);
    const email = page.getByRole("dialog", { name: "Prediction placed" }).getByRole("textbox");

    await expect(email).toHaveCSS("background-color", await tokenValue(page, "color", "var(--fs-surface)"));
    await expect(email).toHaveCSS("border-top-color", await tokenValue(page, "color", "var(--fs-popup-line)"));
    await expect(email).toHaveCSS(
      "border-top-left-radius",
      await tokenValue(page, "borderRadius", "var(--fs-radius-control)"),
    );
  });

  test("brings its mark in by opacity alone under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openHarness(page, `${harness.url}?options=2&state=success&dialog=success`);
    const keys = await page.getByTestId("success-mark").evaluate((mark) =>
      mark
        .getAnimations()
        .flatMap((animation) => (animation.effect as KeyframeEffect).getKeyframes())
        .flatMap((frame) => Object.keys(frame))
        .filter((key) => !["offset", "easing", "composite", "computedOffset"].includes(key)),
    );

    expect([...new Set(keys)]).toEqual(["opacity"]);
  });
});

test.describe("entrances under reduced motion", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  /** The properties each element's running animations change, keyframe offsets and easing aside. */
  const animatedProperties = (elements: Locator) =>
    elements.evaluateAll((nodes) =>
      nodes.map((node) => [
        ...new Set(
          node
            .getAnimations()
            .flatMap((animation) => (animation.effect as KeyframeEffect).getKeyframes())
            .flatMap((frame) => Object.keys(frame))
            .filter((key) => !["offset", "easing", "composite", "computedOffset"].includes(key)),
        ),
      ]),
    );

  test("fade without rising: the failure's status line, and each shared entrance class", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const dialog = await openPopup(page, 2, "failed", "rejected");
    await page.evaluate(() => {
      const host = document.createElement("div");
      host.id = "entrances";
      host.innerHTML =
        '<div class="fs-rise">rise</div><div class="fs-spawn">spawn</div>' +
        '<svg class="fs-icon-draw"><path d="M0 0L8 8"/><polyline points="0,0 8,8"/></svg>';
      document.body.append(host);
    });

    expect(await animatedProperties(dialog.getByRole("status").locator(".fs-enter"))).toEqual([["opacity"]]);
    expect(await animatedProperties(page.locator("#entrances").locator(".fs-rise, .fs-spawn, path, polyline"))).toEqual(
      [["opacity"], ["opacity"], ["opacity"], ["opacity"]],
    );
  });
});

test.describe("the popup's hover tone", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  // the chip tone: the panel tone is about 1.2:1 on the dark surface
  test("tints the close button and the summary's head in the chip tone in the dark theme", async ({ page }) => {
    const dialog = await openPopup(page, 2, "idle", undefined, "&theme=dark");
    for (const control of [
      dialog.getByRole("button", { name: "Close" }),
      dialog.getByTestId("predict-summary").getByRole("button"),
    ]) {
      await control.hover();
      await expect(control).toHaveCSS("background-color", "rgb(46, 32, 108)");
    }
  });
});
