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
/** The states a run passes through from idle, which hold idle's amount and so list the same trades. */
const SAME_TRADES: readonly string[] = ["idle", "quoting", "signing", "confirming", "failed", "pending", "success"];
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
  const head = dialog.getByTestId("predict-summary").getByRole("button").first();
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
        // the cue's nudge ends where it starts, and waiting it out would end it
        .filter((animation) => (animation as CSSAnimation).animationName !== "fsNudgeDown")
        // a scroll-driven animation finishes only at the end of its scroll
        .filter((animation) => animation.timeline === document.timeline)
        // a transition retargeted mid-flight is cancelled, which rejects its promise
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}

/** The boxes a state change must not move: the dialog, its button, and the scrolled body's full height. */
async function footprint(page: Page, dialog: Locator) {
  const box = (await dialog.boundingBox())!;
  const button = (await dialog.locator(".predict-footer > .predict-cta").boundingBox())!;
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

        const barTop = (await dialog.locator(".predict-footer > .predict-cta").boundingBox())!.y;
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

        // open, the summary adds its rows; a run then keeps the open idle popup's footprint
        await openSummary(await openPopup(page, options, "idle"));
        const idleOpen = await footprint(page, page.getByRole("dialog"));
        // where the dialog's top, sides and button sit; its height follows the trades it lists
        const frame = ({ dialog: [x, y, width], footer: [fx, , fwidth, fheight], steps }: typeof idleOpen) => ({
          dialog: [x, y, width],
          footer: [fx, fwidth, fheight],
          steps,
        });
        for (const [state, extra] of [...STATES.map((state) => [state, ""] as const), ["idle", "&first=0"] as const]) {
          const dialog = await openPopup(page, options, state, undefined, extra);
          await openSummary(dialog);
          const open = await footprint(page, dialog);
          if (SAME_TRADES.includes(state) && extra === "") {
            expect.soft(open, `${state} with the summary open`).toEqual(idleOpen);
          } else {
            // another amount, or a stored run, lists other trades
            expect.soft(frame(open), `${state}${extra} with the summary open`).toEqual(frame(idleOpen));
            const box = (await dialog.boundingBox())!;
            expect
              .soft(box.y + box.height, `${state}${extra} open: bottom edge in the window`)
              .toBeLessThanOrEqual(viewport.height);
          }
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

  for (const theme of ["light", "dark"]) {
    test(`draws its cue in the popup's own text and hairline tones in the ${theme} theme`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 568 });
      const dialog = await openPopup(page, 2, "idle", undefined, `&theme=${theme}`);
      const cue = dialog.getByTestId("more-below");
      await expect(cue).toHaveCSS("opacity", "1");
      const [tones, expected] = await cue.evaluate((element) => {
        const probe = document.createElement("span");
        probe.style.color = "var(--fs-popup-text-2)";
        probe.style.borderTopColor = "var(--fs-popup-line)";
        element.parentElement!.append(probe);
        const want = getComputedStyle(probe);
        const got = getComputedStyle(element);
        const pair = [
          [got.color, got.borderTopColor],
          [want.color, want.borderTopColor],
        ];
        probe.remove();
        return pair;
      });
      expect(tones).toEqual(expected);
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

/** The cue nudge's animations, with what each keyframe sets besides its own timing. */
function nudges(page: Page) {
  return page.getByTestId("more-below-nudge").evaluate((arrow) =>
    arrow.getAnimations().map((animation) => ({
      name: (animation as CSSAnimation).animationName,
      iterations: animation.effect!.getTiming().iterations,
      properties: [
        ...new Set(
          (animation.effect as KeyframeEffect)
            .getKeyframes()
            .flatMap((frame) =>
              Object.keys(frame).filter((key) => !["offset", "computedOffset", "easing", "composite"].includes(key)),
            ),
        ),
      ],
    })),
  );
}

/** Records the cue nudge's animation events from the page's first script. */
async function recordNudges(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { nudges: string[] }).nudges = seen;
    for (const type of ["animationstart", "animationiteration", "animationend", "animationcancel"]) {
      document.addEventListener(
        type,
        (event) => {
          const target = event.target as Element;
          if (target.getAttribute?.("data-testid") === "more-below-nudge") {
            seen.push(`${type}:${(event as AnimationEvent).animationName}`);
          }
        },
        true,
      );
    }
  });
  return () => page.evaluate(() => (window as unknown as { nudges: string[] }).nudges);
}

test.describe("the more-below cue's nudge", () => {
  // 375 x 667 opens with every step in view; its cue shows once Details opens
  const CASES = [
    { width: 1280, height: 720, options: 10, details: false },
    { width: 375, height: 640, options: 10, details: false },
    { width: 375, height: 667, options: 2, details: true },
  ];

  for (const { width, height, options, details } of CASES) {
    for (const theme of ["light", "dark"]) {
      test(`nudges three times by transform alone, then rests, at ${width} x ${height} in the ${theme} theme`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height });
        const events = await recordNudges(page);
        const dialog = await openPopup(page, options, "idle", undefined, `&theme=${theme}`);
        const arrow = dialog.getByTestId("more-below-nudge");
        if (details) {
          await expect(arrow).not.toHaveClass(/fs-nudge-down/);
          await openSummary(dialog);
        }
        await expect(dialog.getByTestId("more-below")).toHaveCSS("opacity", "1");

        expect(await nudges(page)).toEqual([{ name: "fsNudgeDown", iterations: 3, properties: ["transform"] }]);
        // at 20 times the rate, the bound is counted without waiting out 6s
        await arrow.evaluate((element) => {
          for (const animation of element.getAnimations()) animation.playbackRate = 20;
        });
        await expect.poll(events).toContain("animationend:fsNudgeDown");
        await page.waitForTimeout(500);

        expect(await events()).toEqual([
          "animationstart:fsNudgeDown",
          "animationiteration:fsNudgeDown",
          "animationiteration:fsNudgeDown",
          "animationend:fsNudgeDown",
        ]);
        await expect(arrow).not.toHaveClass(/fs-nudge-down/);
        expect(await nudges(page)).toEqual([]);
        await expect(dialog.getByTestId("more-below")).toHaveCSS("opacity", "1");
      });
    }
  }

  test("keeps nudging through the body's own scrolls, and stops for good at the visitor's wheel", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 640 });
    const events = await recordNudges(page);
    const dialog = await openPopup(page, 10);
    const scroller = page.getByTestId("predict-body").locator("..");
    const arrow = dialog.getByTestId("more-below-nudge");
    expect(await nudges(page)).toHaveLength(1);

    await scroller.evaluate((element) => element.scrollBy(0, 8));
    await scroller.evaluate((element) => element.scrollTo(0, 0));
    await page.waitForTimeout(300);
    await expect(arrow).toHaveClass(/fs-nudge-down/);

    const box = (await scroller.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 8);
    await expect(arrow).not.toHaveClass(/fs-nudge-down/);
    await scroller.evaluate((element) => element.scrollTo(0, 0));
    await page.waitForTimeout(500);

    await expect(dialog.getByTestId("more-below")).toHaveCSS("opacity", "1");
    expect(await nudges(page)).toEqual([]);
    const seen = await events();
    expect(seen.filter((event) => event.startsWith("animationstart"))).toHaveLength(1);
    expect(seen).not.toContain("animationiteration:fsNudgeDown");
  });

  test("nudges in a popup opened from its button that scrolls its body to a moved figure", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 640 });
    await page.addInitScript(() => {
      const scrolls: number[] = [];
      (window as unknown as { bodyScrolls: number[] }).bodyScrolls = scrolls;
      document.addEventListener(
        "scroll",
        (event) => {
          const target = event.target as Element;
          if (target.firstElementChild?.getAttribute("data-testid") === "predict-body") scrolls.push(target.scrollTop);
        },
        true,
      );
    });
    await openHarness(page, `${harness.url}?options=10&state=moved&credits=enough&open=press`);
    await page.getByRole("button", { name: "Open predict" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Close" })).toBeVisible();
    await expect(dialog).toBeFocused();

    // the moved figure is scrolled to once Details has unfolded
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { bodyScrolls: number[] }).bodyScrolls.length))
      .toBeGreaterThan(0);
    await page.waitForTimeout(600);
    await expect(dialog.getByTestId("more-below")).toHaveCSS("opacity", "1");
    await expect(dialog.getByTestId("more-below-nudge")).toHaveClass(/fs-nudge-down/);
    expect(await nudges(page)).toEqual([{ name: "fsNudgeDown", iterations: 3, properties: ["transform"] }]);
  });

  for (const theme of ["light", "dark"]) {
    test(`holds still under reduced motion in the ${theme} theme`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width: 375, height: 640 });
      const events = await recordNudges(page);
      const dialog = await openPopup(page, 10, "idle", undefined, `&theme=${theme}`);
      await expect(dialog.getByTestId("more-below")).toHaveCSS("opacity", "1");
      await page.waitForTimeout(500);

      expect(await nudges(page)).toEqual([]);
      await expect(dialog.getByTestId("more-below-nudge")).toHaveCSS("animation-name", "none");
      expect(await events()).toEqual([]);
    });
  }

  test("runs on the nudge duration token, and the pricing sweep on the loop token", async ({ page }) => {
    const root = (name: string) =>
      page.evaluate((token) => getComputedStyle(document.documentElement).getPropertyValue(token).trim(), name);
    const retune = (name: string, value: string) =>
      page.evaluate(([token, to]) => document.documentElement.style.setProperty(token!, to!), [name, value]);
    await page.setViewportSize({ width: 375, height: 640 });
    const dialog = await openPopup(page, 10);
    const nudging = dialog.locator(".fs-nudge-down");
    await expect(nudging).toHaveCount(1);
    expect(await root("--fs-dur-nudge")).toBe("2s");
    await expect(nudging).toHaveCSS("animation-duration", "2s");
    await retune("--fs-dur-nudge", "3s");
    await expect(nudging).toHaveCSS("animation-duration", "3s");

    const sweep = (await openPopup(page, 2, "quoting")).locator("[data-testid=pricing-sweep] > i");
    const before = () => sweep.evaluate((node) => getComputedStyle(node, "::before").animationDuration);
    expect(await root("--fs-dur-loop")).toBe("1.6s");
    await expect(sweep).toHaveCSS("animation-duration", "1.6s");
    expect(await before()).toBe("1.6s");
    await retune("--fs-dur-loop", "2.4s");
    await expect(sweep).toHaveCSS("animation-duration", "2.4s");
    expect(await before()).toBe("2.4s");
  });

  test("delays the pricing sweep by the enter token, and turns both spinners on the spin token", async ({ page }) => {
    const root = (name: string) =>
      page.evaluate((token) => getComputedStyle(document.documentElement).getPropertyValue(token).trim(), name);
    const retune = (name: string, value: string) =>
      page.evaluate(([token, to]) => document.documentElement.style.setProperty(token!, to!), [name, value]);
    const dialog = await openPopup(page, 2, "signing");
    const busy = dialog.getByTestId("predict-spinner");
    // the market page's pending status icon, drawn here on its own
    await page.evaluate(() => {
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      icon.setAttribute("class", "fs-icon-pending");
      icon.setAttribute("data-testid", "pending-icon");
      document.body.append(icon);
    });
    const pending = page.getByTestId("pending-icon");
    expect(await root("--fs-dur-spin")).toBe("1s");
    // declared with the other durations, so it reads the same with motion on
    expect(await root("--fs-dur-reduced-fade")).toBe("150ms");
    await expect(busy).toHaveCSS("animation-duration", "1s");
    await expect(pending).toHaveCSS("animation-duration", "1s");
    await retune("--fs-dur-spin", "1.5s");
    await expect(busy).toHaveCSS("animation-duration", "1.5s");
    await expect(pending).toHaveCSS("animation-duration", "1.5s");

    const sweep = (await openPopup(page, 2, "quoting")).locator("[data-testid=pricing-sweep] > i");
    const before = () => sweep.evaluate((node) => getComputedStyle(node, "::before").animationDelay);
    await expect(sweep).toHaveCSS("animation-delay", "0.25s");
    await retune("--fs-dur-enter", "400ms");
    await expect(sweep).toHaveCSS("animation-delay", "0.4s");
    expect(await before()).toBe("0.4s");
  });

  test("fades in place on the reduced-fade token under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openHarness(page, `${harness.url}?dialog=success`);
    const mark = page.locator(".predict-success-mark");
    await expect(mark).toHaveCSS("animation-name", "fsFadeIn");
    expect(
      await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--fs-dur-reduced-fade").trim(),
      ),
    ).toBe("150ms");
    await expect(mark).toHaveCSS("animation-duration", "0.15s");
    await page.evaluate(() => document.documentElement.style.setProperty("--fs-dur-reduced-fade", "90ms"));
    await expect(mark).toHaveCSS("animation-duration", "0.09s");
  });

  // a two-line status starts right under the strip, so the burst there is smaller
  const AMPLITUDES = [
    { width: 1280, height: 720, state: "idle&leftOut=1", lines: 1, lift: 3, drop: 6 },
    { width: 375, height: 640, state: "idle&leftOut=1", lines: 1, lift: 3, drop: 6 },
    { width: 375, height: 640, state: "moved", lines: 2, lift: 2, drop: 3 },
    { width: 320, height: 568, state: "moved", lines: 2, lift: 2, drop: 3 },
  ];
  for (const { width, height, state, lines, lift, drop } of AMPLITUDES) {
    test(`lifts ${lift}px and drops ${drop}px with its words, clear of a ${lines}-line status, at ${width} x ${height}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      // opened once the fonts are in, so the bursts are still running when they are measured
      await openHarness(page, `${harness.url}?options=10&state=${state}&open=press`);
      await page.getByRole("button", { name: "Open predict" }).click();
      const dialog = page.getByRole("dialog");
      const cue = dialog.getByTestId("more-below");
      const nudge = dialog.getByTestId("more-below-nudge");
      await expect(nudge).toHaveClass(/fs-nudge-down/);
      await nudge.evaluate((element) => element.getAnimations().forEach((animation) => animation.pause()));
      await settle(dialog);
      const strip = (await cue.boundingBox())!;
      expect(await cue.evaluate((element) => getComputedStyle(element).paddingTop)).toBe("6px");
      const status = await dialog.getByTestId("status-text").evaluate(inkOf);
      expect(status.lines, "the status line's lines").toBe(lines);

      const at = (time: number) =>
        nudge.evaluate(
          (element, [time, measure]) => {
            for (const animation of element.getAnimations()) {
              animation.pause();
              animation.currentTime = time as number;
            }
            const arrow = element.querySelector("[data-testid=more-below-arrow]")!.getBoundingClientRect();
            const words = new Function(`return ${measure}`)()(element);
            return {
              shift: new DOMMatrixReadOnly(getComputedStyle(element).transform).f,
              arrow: { top: arrow.top, bottom: arrow.bottom },
              words,
            };
          },
          [time, inkOf.toString()] as const,
        );
      const still = await at(0);
      // the delay, then the lift's peak at 12.5% and the drop's at 25% of 2s
      for (const [time, shift] of [
        [0, 0],
        [500, -lift],
        [750, drop],
      ] as const) {
        const now = await at(time);
        expect.soft(now.shift, `${time}ms: moved by`).toBe(shift);
        expect.soft(now.arrow.top - still.arrow.top, `${time}ms: the arrow moved by`).toBeCloseTo(shift, 3);
        expect.soft(now.words.top - still.words.top, `${time}ms: the words moved by`).toBeCloseTo(shift, 3);
        expect.soft(now.arrow.top, `${time}ms: below the hairline`).toBeGreaterThan(strip.y + 1);
        expect.soft(now.arrow.bottom, `${time}ms: the arrow clear of the status text`).toBeLessThan(status.top);
        expect.soft(now.words.bottom, `${time}ms: the words clear of the status text`).toBeLessThan(status.top);
      }
    });
  }
});

/** The ink of an element's own text, from its first line box and the font's measure of the words, and its line count. */
function inkOf(element: Element): { top: number; bottom: number; lines: number } {
  const text = [...element.childNodes].find((node) => node.nodeType === Node.TEXT_NODE)!;
  const range = document.createRange();
  range.selectNodeContents(text);
  const boxes = [...range.getClientRects()];
  const context = document.createElement("canvas").getContext("2d")!;
  context.font = getComputedStyle(element).font;
  const metrics = context.measureText(text.textContent ?? "");
  const baseline = boxes[0]!.top + metrics.fontBoundingBoxAscent;
  return {
    top: baseline - metrics.actualBoundingBoxAscent,
    bottom: baseline + metrics.actualBoundingBoxDescent,
    lines: new Set(boxes.map((box) => Math.round(box.top))).size,
  };
}

for (const viewport of [
  { width: 375, height: 667 },
  { width: 360, height: 640 },
  { width: 320, height: 568 },
  { width: 568, height: 320 },
]) {
  test.describe(`a popup on a short screen at ${viewport.width} x ${viewport.height}`, () => {
    test.use({ viewport });

    test("keeps the share slider and a 44px status slot", async ({ page }) => {
      const dialog = await openPopup(page, 2, "failed", "funds");

      await expect(dialog.getByTestId("amount-slider")).toBeVisible();
      expect((await dialog.getByRole("status").boundingBox())!.height).toBe(44);
    });

    for (const extra of ["", "&credits=enough"]) {
      test(`gives the slider its own row and every control beside it its own pixels${extra}`, async ({ page }) => {
        await openHarness(page, `${harness.url}?options=2&state=idle${extra}`);
        const dialog = page.getByRole("dialog");
        await expect(dialog.getByTestId("amount-slider")).toBeVisible();
        await settle(dialog);
        const probe = await dialog.evaluate((element) => {
          const slider = element.querySelector("[data-testid=amount-slider]")!;
          slider.scrollIntoView({ block: "center" });
          const hit = element.querySelector("div:has(> #slider-track)")!.getBoundingClientRect();
          const x = hit.left + hit.width / 2;
          // the run of pixels down the track's middle that land on the slider
          let target = 0;
          for (let y = Math.ceil(hit.top); y < hit.bottom; y++) {
            if (slider.contains(document.elementFromPoint(x, y))) target++;
          }
          const neighbours = [
            element.querySelector("[data-testid=predict-summary] button"),
            element.querySelector("[data-testid=credits-line] label"),
            element.querySelector("[data-testid=credits-line] button"),
          ].filter((control): control is Element => control !== null);
          const lost = neighbours.filter((control) => {
            const box = control.getBoundingClientRect();
            const y = box.top < hit.bottom && box.bottom > hit.bottom ? box.top + 1 : box.bottom - 1;
            if (y < hit.top || y > hit.bottom) return false;
            return slider.contains(document.elementFromPoint(box.left + Math.min(8, box.width / 2), y));
          });
          return { target, lost: lost.map((control) => control.textContent) };
        });
        expect(probe.lost, "controls whose edge the slider takes").toEqual([]);
        expect(probe.target, "pixels down the track that move the slider").toBeGreaterThanOrEqual(32);
      });
    }
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
      expect((await dialog.locator(".predict-footer > .predict-cta").boundingBox())!.height).toBe(52);
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

    test("fits its words in its 44px status slot, its callout under the title, without moving the footer", async ({
      page,
    }) => {
      const idle = await footprint(page, await openPopup(page, 10, "idle"));
      for (const reason of FAILURE_REASONS) {
        const dialog = await openPopup(page, 10, "failed", reason);
        const status = dialog.getByRole("status");
        const [text, title] = await Promise.all([
          status.getByTestId("status-box").boundingBox(),
          dialog.getByRole("heading", { name: "Predict", exact: true }).boundingBox(),
        ]);

        expect.soft(await status.evaluate((element) => getComputedStyle(element).textAlign), reason).toBe("left");
        expect.soft(Math.abs(text!.x - title!.x), `${reason} starts under the title`).toBeLessThanOrEqual(1);
        expect.soft((await status.boundingBox())!.height, `${reason}: the slot`).toBe(44);
        expect
          .soft(
            await status
              .getByTestId("status-box")
              .evaluate((element) => element.scrollHeight <= element.clientHeight + 1),
            `${reason}: the words fit the callout`,
          )
          .toBe(true);

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

    test("opens with the reason Predict is off in view", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      for (const state of ["disconnected", "failed", "pending"] as const) {
        for (const options of [2, 10]) {
          const dialog = await openPopup(page, options, state);
          const status = dialog.getByTestId("status-text");
          await expect(status).not.toBeEmpty();
          // both scrolls wait a frame
          await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
          expect.soft(await isFullyShown(status), `${state}, ${options} options`).toBe(true);
        }
      }
    });

    for (const state of ["idle", "failed", "pending", "disconnected"] as const) {
      test(`opens ${state} with its close button whole and nothing to scroll sideways`, async ({ page }) => {
        await page.emulateMedia({ reducedMotion: "reduce" });
        for (const options of [2, 10]) {
          const dialog = await openPopup(page, options, state);
          const close = dialog.getByRole("button", { name: "Close" });
          const sideways = await close.evaluate((element) => {
            let scroller = element.parentElement;
            while (scroller && getComputedStyle(scroller).overflowY !== "auto") scroller = scroller.parentElement;
            return scroller ? scroller.scrollWidth - scroller.clientWidth : 0;
          });
          expect.soft(sideways, `${options} options: sideways scroll`).toBe(0);
          const [padding, bars] = await close.evaluate((element) => {
            let scroller = element.parentElement!;
            while (getComputedStyle(scroller).overflowY !== "auto") scroller = scroller.parentElement!;
            const footer = scroller.querySelector(".predict-footer > .predict-cta")!.parentElement!;
            const { scrollPaddingTop, scrollPaddingBottom } = getComputedStyle(scroller);
            return [
              [parseFloat(scrollPaddingTop), parseFloat(scrollPaddingBottom)],
              [element.closest<HTMLElement>(".predict-header")!.offsetHeight, footer.offsetHeight],
            ];
          });
          expect
            .soft(padding, `${options} options: scroll padding as tall as the sticky header and footer`)
            .toEqual(bars);
          expect.soft(await isFullyShown(close), `${options} options: the close button at open`).toBe(true);
        }
      });
    }

    test("covers what scrolls under its header with the surface and a fade, not a hard cut", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      const dialog = await openPopup(page, 10, "idle");
      const header = dialog.getByRole("heading", { name: "Predict", exact: true, level: 2 }).locator("..");
      // a scroll-driven opacity is drawn on the next frame
      const fadeAt = (scrollTop: number) =>
        header.evaluate(async (element, top) => {
          element.parentElement!.scrollTop = top;
          await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
          return getComputedStyle(element, "::after").opacity;
        }, scrollTop);
      // without scroll-driven animations the fade always shows
      if (await page.evaluate(() => CSS.supports("animation-timeline: scroll()"))) {
        expect(await fadeAt(0), "no fade over the first estimate at rest").toBe("0");
      }
      expect(await fadeAt(40), "the fade shows once the body has scrolled").toBe("1");
      const look = await header.evaluate((element) => {
        const own = getComputedStyle(element);
        const fade = getComputedStyle(element, "::after");
        return {
          gap: parseFloat(own.marginBottom),
          fade: parseFloat(fade.height),
          gradient: fade.backgroundImage.startsWith("linear-gradient"),
          below: parseFloat(fade.top) >= (element as HTMLElement).offsetHeight - 1,
        };
      });
      expect(look.gap, "no see-through margin under the header").toBe(0);
      expect(look.fade, "a fade at least 12px tall").toBeGreaterThanOrEqual(12);
      expect(look.gradient, "the fade is a gradient").toBe(true);
      expect(look.below, "the fade hangs below the header").toBe(true);
    });

    for (const [state, extra] of [
      ["signing", "&step=1"],
      ["signing", ""],
      ["confirming", ""],
    ] as const) {
      test(`keeps the running step below the header when a note shows mid-run, ${state}${extra}`, async ({ page }) => {
        await page.emulateMedia({ reducedMotion: "reduce" });
        for (const options of [2, 10]) {
          const dialog = await openPopup(page, options, state, undefined, extra);
          await page.evaluate(() => window.dispatchEvent(new CustomEvent("harness-left-out", { detail: 2 })));
          await expect(dialog.getByRole("status")).toHaveText("2 estimates could not be traded.");
          // a scroll waits a frame after the render
          await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
          const row = dialog.locator(".predict-steps > li").filter({ has: page.locator('[data-bullet="running"]') });
          const title = row.getByText(new RegExp(`^(${STEPS.join("|")})$`));
          const header = (await dialog
            .getByRole("heading", { name: "Predict", exact: true, level: 2 })
            .locator("..")
            .boundingBox())!;
          const bullet = (await dialog.locator('[data-bullet="running"]').boundingBox())!;
          expect
            .soft(bullet.y, `${options} options: the running bullet's top below the header`)
            .toBeGreaterThanOrEqual(header.y + header.height);
          expect.soft(await isFullyShown(title), `${options} options: its title`).toBe(true);
        }
      });
    }

    for (const [state, line] of [
      ["idle", /in your trade wallet/],
      ["over", /^Not enough balance/],
    ] as const) {
      test(`keeps the amount's line above the button when Tab reaches the field, ${state}`, async ({ page }) => {
        await page.emulateMedia({ reducedMotion: "reduce" });
        for (const options of [2, 10]) {
          const dialog = await openPopup(page, options, state);
          const input = dialog.getByLabel("Amount");
          await dialog.evaluate((element) => {
            const scroller = [...element.querySelectorAll("div")].find(
              (node) => getComputedStyle(node).overflowY === "auto" && node.scrollHeight > node.clientHeight,
            );
            if (scroller) scroller.scrollTop = 0;
          });
          for (let step = 0; step < 80 && !(await input.evaluate((node) => node === document.activeElement)); step++) {
            await page.keyboard.press("Tab");
          }
          await expect(input).toBeFocused();
          await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
          const summary = dialog.locator('[data-panel="amount"] > p').filter({ hasText: line });
          await expect(summary).toHaveCount(1);
          expect.soft(await isFullyShown(input), `${options} options: the field`).toBe(true);
          expect.soft(await isFullyShown(summary), `${options} options: the line under it`).toBe(true);
        }
      });
    }

    for (const state of ["idle", "failed"] as const) {
      test(`keeps the button inside the dialog and every part reachable above it, ${state}`, async ({ page }) => {
        // the open's scroll then lands at once
        await page.emulateMedia({ reducedMotion: "reduce" });
        const dialog = await openPopup(page, 10, state);
        const box = (await dialog.boundingBox())!;
        const button = dialog.locator(".predict-footer > .predict-cta");
        const buttonBox = (await button.boundingBox())!;
        expect(buttonBox.y + buttonBox.height, "the button's foot").toBeLessThanOrEqual(box.y + box.height);
        if (state === "failed") {
          expect(await isFullyShown(dialog.getByRole("status")), "the failure's reason at open").toBe(true);
          expect(await isFullyShown(dialog.locator('[data-bullet="failed"]')), "the failed step at open").toBe(true);
        }

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
          const header = (await dialog.getByRole("heading", { name: "Predict", exact: true, level: 2 }).boundingBox())!;
          expect(partBox.y, "a part's top below the header").toBeGreaterThanOrEqual(header.y + header.height - 1);
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

for (const [width, tokens] of [
  [320, 1],
  [320, 2],
  [375, 1],
  [375, 2],
] as const) {
  test.describe(`the amount field with a long number at ${width} x 812, ${tokens} pay tokens`, () => {
    test.use({ viewport: { width, height: 812 } });

    test("steps its size down as the number grows, to a 16px floor, and has no stepper", async ({ page }) => {
      const dialog = await openPopup(page, 2, "idle", undefined, tokens === 2 ? "&tokens=2" : "");
      const input = dialog.getByLabel("Amount");
      const read = () =>
        input.evaluate((element) => ({
          size: parseFloat(getComputedStyle(element).fontSize),
          fits: element.scrollWidth <= element.clientWidth,
        }));

      await expect.poll(read, "the amount at open").toEqual({ size: 30, fits: true });
      for (const typed of ["12345", "123456", "1234567", "12345.67", "123456789", "100.123456789012345678"]) {
        await input.fill(typed);
        const { size, fits } = await read();
        // under 16px a phone zooms the page into a focused field
        expect.soft(size, `${typed}: no smaller than the floor`).toBeGreaterThanOrEqual(16);
        expect.soft(fits || size === 16, `${typed}: scrolls only at the floor (${size}px)`).toBe(true);
      }
      await input.fill("123456");
      expect(await read(), "six digits fit").toMatchObject({ fits: true });
      await input.fill("10");
      await expect.poll(read, "a short number grows back").toEqual({ size: 30, fits: true });

      // a blur groups the digits, which widens the value
      await input.fill("12345678");
      await dialog.getByRole("heading", { name: "Predict", exact: true }).click();
      await expect(input).toHaveValue("12,345,678");
      await expect
        .poll(async () => {
          const { size, fits } = await read();
          return fits || size === 16;
        }, "the grouped value refits")
        .toBe(true);

      await input.hover();
      const steppers = dialog.getByTestId("amount-input").locator(".input-wrapper button");
      for (const stepper of await steppers.all()) await expect(stepper).toBeHidden();
    });

    test("fits a nine-digit amount at rest", async ({ page }) => {
      const dialog = await openPopup(page, 2, "over", undefined, `&held=123456789${tokens === 2 ? "&tokens=2" : ""}`);
      const input = dialog.getByLabel("Amount");
      await expect(input).toHaveValue(/^123,?457,?769$/);
      const fits = () => input.evaluate((element) => element.scrollWidth <= element.clientWidth);
      if (width === 320 && tokens === 2) {
        // a 75px field holds seven digits at the floor
        expect(await input.evaluate((element) => getComputedStyle(element).fontSize)).toBe("16px");
      } else {
        await expect.poll(fits).toBe(true);
      }
    });
  });
}

test.describe("an amount set by Max", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("groups its digits at once, as the balance beside it does, and ungroups them for typing", async ({ page }) => {
    const dialog = await openPopup(page, 2, "idle", undefined, "&held=123456789");
    const input = dialog.getByLabel("Amount");
    await expect(dialog.getByTestId("balance-figure")).toHaveText("123,456,795 sDAI");

    await dialog.getByRole("button", { name: "Max" }).click();
    // the library groups a set value on its own after 3s
    await expect(input).toHaveValue("123,456,795", { timeout: 1000 });

    await input.focus();
    await expect(input).toHaveValue("123456795");
    // Home is the spinbutton's jump to its minimum, so the caret is placed directly
    await input.evaluate((element) => (element as HTMLInputElement).setSelectionRange(0, 0));
    await input.pressSequentially("9");
    await expect(input).toHaveValue("9123456795");
    expect(await input.evaluate((element) => (element as HTMLInputElement).selectionStart)).toBe(1);
    await dialog.getByRole("heading", { name: "Predict", exact: true }).click();
    await expect(input).toHaveValue("9,123,456,795", { timeout: 1000 });
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

test.describe("the pay token's open menu", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  for (const theme of ["light", "dark"]) {
    test(`is a rounded list on the popup's surface, its rows in the popup's text and the choice in the chip tone, in the ${theme} theme`, async ({
      page,
    }) => {
      await openPopup(page, 2, "idle", undefined, `&tokens=2&theme=${theme}`);
      await page.getByRole("button", { name: /sDAI/ }).click();
      const listbox = page.getByRole("listbox");
      await expect(listbox).toBeVisible();
      await settle(page.locator("body"));

      const read = await listbox.evaluate((list) => {
        const resolve = (property: string, value: string) => {
          const probe = document.createElement("span");
          probe.style.setProperty(property, value);
          document.body.append(probe);
          const resolved = getComputedStyle(probe).getPropertyValue(property);
          probe.remove();
          return resolved;
        };
        const popover = list.closest("[data-trigger]") ?? list.parentElement!.parentElement!;
        const rows = [...list.querySelectorAll<HTMLElement>("[role=option]")];
        const chosen = rows.find((row) => row.getAttribute("aria-selected") === "true")!;
        const label = (row: HTMLElement) => getComputedStyle(row.querySelector("p")!);
        return {
          radius: getComputedStyle(popover).borderTopLeftRadius,
          surface: [getComputedStyle(popover).backgroundColor, resolve("background-color", "var(--fs-surface)")],
          line: [getComputedStyle(popover).borderTopColor, resolve("border-top-color", "var(--fs-popup-line)")],
          heights: rows.map((row) => row.getBoundingClientRect().height),
          sizes: rows.map((row) => label(row).fontSize),
          text: [label(rows[1]!).color, resolve("color", "var(--fs-popup-text)")],
          chosen: [getComputedStyle(chosen).backgroundColor, resolve("background-color", "var(--fs-popup-chip)")],
          bar: getComputedStyle(chosen).borderLeftWidth,
        };
      });

      expect(read.radius).toBe("10px");
      expect(read.surface[0]).toBe(read.surface[1]);
      expect(read.line[0]).toBe(read.line[1]);
      expect(read.heights).toEqual([40, 40]);
      expect(read.sizes).toEqual(["15px", "15px"]);
      expect(read.text[0]).toBe(read.text[1]);
      expect(read.chosen[0]).toBe(read.chosen[1]);
      expect(read.bar).toBe("0px");
    });

    test(`keeps the choice apart from a row the keyboard reaches, in the ${theme} theme`, async ({ page }) => {
      await openPopup(page, 2, "idle", undefined, `&tokens=2&theme=${theme}`);
      await page.getByRole("button", { name: /sDAI/ }).focus();
      await page.keyboard.press("Enter");
      const listbox = page.getByRole("listbox");
      await expect(listbox).toBeVisible();
      await page.keyboard.press("ArrowDown");
      const other = listbox.getByRole("option", { name: "xDAI" });
      await expect(other).toHaveAttribute("data-focused", "true");
      await settle(page.locator("body"));

      const [chosen, reached, accent] = await listbox.evaluate((list) => {
        const look = (row: Element) => {
          const label = getComputedStyle(row.querySelector("p")!);
          return { background: getComputedStyle(row).backgroundColor, color: label.color, weight: label.fontWeight };
        };
        const probe = document.createElement("span");
        probe.style.color = "var(--fs-popup-accent-text)";
        document.body.append(probe);
        const tone = getComputedStyle(probe).color;
        probe.remove();
        return [look(list.querySelector('[aria-selected="true"]')!), look(list.querySelector("[data-focused]")!), tone];
      });
      expect(chosen.color, "the choice in the accent text").toBe(accent);
      expect(chosen.color).not.toBe(reached.color);
      expect(Number(chosen.weight)).toBeGreaterThan(Number(reached.weight));

      const ring = await other.evaluate((row) => {
        const probe = document.createElement("span");
        probe.style.color = "var(--fs-popup-accent)";
        document.body.append(probe);
        const violet = getComputedStyle(probe).color;
        probe.remove();
        const style = getComputedStyle(row);
        const reach = parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth);
        const box = row.getBoundingClientRect();
        const clippedBy: string[] = [];
        for (let parent = row.parentElement; parent; parent = parent.parentElement) {
          const { overflowX, overflowY } = getComputedStyle(parent);
          if (overflowX === "visible" && overflowY === "visible") continue;
          const clip = parent.getBoundingClientRect();
          if (
            box.left - reach < clip.left - 0.5 ||
            box.right + reach > clip.right + 0.5 ||
            box.top - reach < clip.top - 0.5 ||
            box.bottom + reach > clip.bottom + 0.5
          ) {
            clippedBy.push(parent.className || parent.tagName);
          }
        }
        return {
          outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`,
          expected: `solid 2px ${violet}`,
          shadowRing: /\d+px [1-9]/.test(style.boxShadow),
          clippedBy,
        };
      });
      expect(ring.outline, "the reached row's ring in the violet").toBe(ring.expected);
      expect(ring.shadowRing, "no second ring").toBe(false);
      expect(ring.clippedBy, "the ring whole inside the list").toEqual([]);
    });
  }
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

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 375, height: 812 },
]) {
  for (const theme of ["light", "dark"]) {
    test(`the share slider at 0% paints only its track along its line, ${viewport.width} x ${viewport.height} ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const dialog = await openPopup(page, 2, "idle", undefined, `&first=0&theme=${theme}`);
      const slider = dialog.getByTestId("amount-slider");
      await expect(dialog.getByTestId("amount-share")).toHaveText("0%");

      const strays = await slider.locator("#slider-track").evaluate((track) => {
        const row = track.closest("[data-testid=amount-slider]")!;
        const line = track.getBoundingClientRect();
        // past the thumb at 0%, anything drawn over or beside the track's line
        const from = line.left + line.width * 0.2;
        // react-aria's range input is visually hidden
        return [...row.querySelectorAll(":not(input)")]
          .filter((element) => !element.contains(track) && !track.contains(element))
          .filter((element) => getComputedStyle(element).visibility === "visible")
          .filter((element) => {
            const box = element.getBoundingClientRect();
            return (
              box.width > 0 &&
              box.height > 0 &&
              box.right > from &&
              box.left < line.right + 4 &&
              box.bottom > line.top - 4 &&
              box.top < line.bottom + 4
            );
          })
          .map((element) => element.outerHTML.slice(0, 80));
      });
      expect(strays, "only the track paints along its line").toEqual([]);
    });
  }
}

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 375, height: 812 },
]) {
  for (const theme of ["light", "dark"]) {
    test(`the share slider's rail, fill and thumb are 3:1 against what they sit on, ${viewport.width} x ${viewport.height} ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const dialog = await openPopup(page, 2, "idle", undefined, `&theme=${theme}`);
      const slider = dialog.getByTestId("amount-slider");
      const [track, fill, thumb] = await Promise.all([
        slider.locator("#slider-track").boundingBox(),
        slider.locator("#slider-fill").boundingBox(),
        slider.locator("div:has(>#slider-label)").boundingBox(),
      ]);
      const shot = (await page.screenshot()).toString("base64");
      // halfway along the unfilled rail, and along the fill clear of its rounded end and the thumb
      const open = Math.round((thumb!.x + thumb!.width + track!.x + track!.width) / 2);
      const centre = Math.floor(track!.y + track!.height / 2);
      const points = {
        panel: [open, Math.floor(track!.y) - 5],
        edge: [open, Math.floor(track!.y)],
        rail: [open, centre],
        fillStart: [Math.round(fill!.x + 6), centre],
        fillEnd: [Math.round(thumb!.x - 4), centre],
        thumbPanel: [Math.round(thumb!.x + thumb!.width / 2), Math.floor(thumb!.y) - 3],
        thumbRing: [Math.round(thumb!.x + thumb!.width / 2), Math.floor(thumb!.y) + 1],
      };
      const px = await page.evaluate(
        async ({ shot, points }) => {
          const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${shot}`)).blob());
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const context = canvas.getContext("2d")!;
          context.drawImage(bitmap, 0, 0);
          const scale = bitmap.width / window.innerWidth;
          return Object.fromEntries(
            Object.entries(points).map(([name, [x, y]]) => [
              name,
              `rgb(${context
                .getImageData(Math.floor(x! * scale), Math.floor(y! * scale), 1, 1)
                .data.slice(0, 3)
                .join(", ")})`,
            ]),
          );
        },
        { shot, points },
      );

      expect.soft(contrast(px.edge!, px.panel!), "the rail's edge on the panel").toBeGreaterThanOrEqual(3);
      expect.soft(contrast(px.fillStart!, px.rail!), "the fill's start on the rail").toBeGreaterThanOrEqual(3);
      expect.soft(contrast(px.fillEnd!, px.rail!), "the fill's end on the rail").toBeGreaterThanOrEqual(3);
      expect.soft(contrast(px.thumbRing!, px.thumbPanel!), "the thumb's ring on the panel").toBeGreaterThanOrEqual(3);
    });
  }
}

/** Four-decimal credits from the visitor's wallet and a seven-figure xDAI deposit: the longest the funds step says. */
const WORST_FUNDS = "&trades=worst&pay=native&credits=odd";

for (const viewport of [
  { width: 320, height: 568 },
  { width: 375, height: 812 },
  { width: 1280, height: 800 },
]) {
  for (const theme of ["light", "dark"]) {
    test(`the Add funds step says credits and a seven-figure xDAI deposit whole, in a row of one height, ${viewport.width} x ${viewport.height} ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const heights: number[] = [];
      for (const state of ["idle", "signing", "failed"] as const) {
        const dialog = await openPopup(page, 2, state, undefined, `${WORST_FUNDS}&theme=${theme}`);
        const row = dialog.locator(".predict-steps > li").filter({ hasText: "Add funds" });
        heights.push((await row.boundingBox())!.height);
        if (state !== "idle") continue;

        const value = row.locator("h2 + p");
        await expect(value).toHaveText(/^16\.2588\scredits\s\+\s1,234,\d{3}\.\d{4}\sxDAI$/);
        const fit = await value.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const column = element.closest("li")!.querySelector(":scope > div:nth-child(2)")!.getBoundingClientRect();
          return {
            cut: element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1,
            inside: box.left >= column.left - 1 && box.right <= column.right + 1 && box.bottom <= column.bottom + 1,
          };
        });
        expect(fit).toEqual({ cut: false, inside: true });
      }
      expect(new Set(heights).size, `the row's heights across idle, signing and failed: ${heights}`).toBe(1);
    });
  }
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

  // a window up to 480px tall scrolls the whole popup, whose scroller clips at its edges
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 568, height: 320 },
  ]) {
    test.describe(`at ${viewport.width} x ${viewport.height}`, () => {
      test.use({ viewport });

      for (const theme of ["light", "dark"]) {
        test(`rings each control reached by keyboard once, in the popup's violet, in the ${theme} theme`, async ({
          page,
        }) => {
          const dialog = await openPopup(page, 2, "idle", undefined, `&tokens=2&theme=${theme}`);
          const accent = await dialog.evaluate((element) => {
            const probe = document.createElement("span");
            probe.style.color = "var(--fs-popup-accent)";
            element.append(probe);
            const color = getComputedStyle(probe).color;
            probe.remove();
            return color;
          });
          expect(accent).toBe(theme === "light" ? "rgb(107, 60, 245)" : "rgb(155, 123, 255)");

          const seen: string[] = [];
          // the header's gear and close, the list's removes, the amount's controls, the summary, then Predict
          for (let step = 0; step < 12; step++) {
            await page.keyboard.press("Tab");
            // the ring's colour transitions in
            await settle(dialog);
            const ring = await page.evaluate(() => {
              const element = document.activeElement as HTMLElement;
              // the amount field and the share slider's input draw on their panel or thumb
              const drawn = element.matches("[data-panel=amount] input[inputmode]")
                ? element.closest<HTMLElement>("[data-panel]")!
                : element.matches("[type=range]")
                  ? element.closest<HTMLElement>("div:has(>#slider-label)")!
                  : element;
              const style = getComputedStyle(drawn);
              // a ring's offset is a band of the nearest painted box under it; any other band is a second mark
              let under = "";
              for (let parent = drawn.parentElement; parent && !under; parent = parent.parentElement) {
                const fill = getComputedStyle(parent).backgroundColor;
                if (fill !== "rgba(0, 0, 0, 0)") under = fill;
              }
              const rings = (style.boxShadow.match(/rgb\([^)]*\) 0px 0px 0px [1-9]\d*px/g) ?? []).filter(
                (shadow) => !shadow.startsWith(under),
              );
              // the panel rings for the amount field alone
              const panel = element.closest("[data-panel=amount]");
              if (panel && panel !== drawn && getComputedStyle(panel).boxShadow.includes(" 2px inset"))
                rings.push("panel");
              // the outline's outer edge, inside every box that clips it
              const reach =
                style.outlineStyle === "none" ? 0 : parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth);
              const box = drawn.getBoundingClientRect();
              let clipped = false;
              for (let parent = drawn.parentElement; parent; parent = parent.parentElement) {
                const { overflowX, overflowY } = getComputedStyle(parent);
                if (overflowX === "visible" && overflowY === "visible") continue;
                const clip = parent.getBoundingClientRect();
                if (
                  box.left - reach < clip.left - 0.5 ||
                  box.right + reach > clip.right + 0.5 ||
                  box.top - reach < clip.top - 0.5 ||
                  box.bottom + reach > clip.bottom + 0.5
                ) {
                  clipped = true;
                }
              }
              return {
                name: element.getAttribute("aria-label") || element.textContent?.trim() || element.tagName,
                outline: style.outlineStyle === "none" ? null : `${style.outlineWidth} ${style.outlineColor}`,
                rings,
                clipped,
              };
            });
            seen.push(ring.name);
            const marks = [
              ...(ring.outline ? [ring.outline] : []),
              ...ring.rings.map((shadow) => shadow.split(" 0px")[0]),
            ];
            expect.soft(marks.length, `${ring.name}: one ring`).toBe(1);
            expect.soft(marks[0], `${ring.name}: in the violet`).toContain(accent);
            expect.soft(ring.clipped, `${ring.name}: the ring whole`).toBe(false);
          }
          expect(seen).toEqual(expect.arrayContaining(["Close", "Max", "Token", "2 markets move", "Predict"]));
        });
      }
    });
  }
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

    const accent = await panel.evaluate((element) => {
      const probe = document.createElement("span");
      probe.style.color = "var(--fs-popup-accent)";
      element.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    });
    expect(await shadow()).not.toBe(atRest);
    expect(await shadow()).toContain(`${accent} 0px 0px 0px 2px inset`);
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
    expect(
      await dialog.getByTestId("status-glyph").evaluate((glyph) => getComputedStyle(glyph).color),
      "the failure's glyph",
    ).toBe("rgb(196, 0, 42)");
  });
});

/** The callout's surface, glyph and sentence as opaque rgb, read through a canvas so color-mix() resolves. */
function calloutColours(dialog: Locator) {
  return dialog.getByRole("status").evaluate((status) => {
    const box = status.querySelector<HTMLElement>("[data-testid=status-box]")!;
    const glyph = status.querySelector<SVGElement>("[data-testid=status-glyph]")!;
    const text = status.querySelector<HTMLElement>("[data-testid=status-text]")!;
    const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    const rgb = (css: string, under = "#ffffff") => {
      context.fillStyle = under;
      context.fillRect(0, 0, 1, 1);
      context.fillStyle = css;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
      return `rgb(${r}, ${g}, ${b})`;
    };
    const sheet = rgb(getComputedStyle(status.closest("[role=dialog]")!).backgroundColor);
    const surface = getComputedStyle(box).backgroundColor;
    const glyphBox = glyph.getBoundingClientRect();
    return {
      surface: surface === "rgba(0, 0, 0, 0)" ? "transparent" : rgb(surface, sheet),
      under: rgb(surface, sheet),
      glyph: rgb(getComputedStyle(glyph).color),
      text: rgb(getComputedStyle(text).color),
      glyphSize: [glyphBox.width, glyphBox.height],
      radius: getComputedStyle(box).borderTopLeftRadius,
      enters: box.classList.contains("fs-enter"),
    };
  });
}

test.describe("the status callout", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  for (const { width, height, size } of [
    { width: 1280, height: 800, size: ["13px", "17px"] },
    { width: 375, height: 812, size: ["13px", "17px"] },
    { width: 375, height: 667, size: ["12px", "16px"] },
    { width: 320, height: 568, size: ["12px", "16px"] },
  ]) {
    test(`sets its sentence at ${size.join("/")} at ${width} x ${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const dialog = await openPopup(page, 2, "failed", "reverted");
      const text = dialog.getByTestId("status-text");
      await expect(text).not.toBeEmpty();
      expect(
        await text.evaluate((element) => [getComputedStyle(element).fontSize, getComputedStyle(element).lineHeight]),
      ).toEqual(size);
    });
  }

  for (const theme of ["light", "dark"] as const) {
    const TONES = [
      { tone: "error", extra: "&state=failed&reason=reverted", surface: true, enters: true },
      { tone: "warning", extra: "&state=moved", surface: true, enters: true },
      { tone: "neutral", extra: "&leftOut=2", surface: false, enters: false },
    ] as const;
    for (const { tone, extra, surface, enters } of TONES) {
      test(`says ${tone === "error" ? "an" : "a"} ${tone} line in ink beside a 16px glyph in its tone, ${surface ? "on a tinted surface" : "on the sheet"}, in the ${theme} theme`, async ({
        page,
      }) => {
        await page.emulateMedia({ reducedMotion: "reduce" });
        await openHarness(page, `${harness.url}?options=2&theme=${theme}${extra}`);
        const dialog = page.getByRole("dialog");
        await expect(dialog.getByTestId("status-text")).not.toBeEmpty();
        const colours = await calloutColours(dialog);
        const [ink, tint, ink2] = await Promise.all([
          tokenValue(page, "color", "var(--fs-popup-text)"),
          tokenValue(
            page,
            "color",
            `var(--fs-tone-${tone === "neutral" ? "neutral" : tone}-text, var(--fs-popup-text-3))`,
          ),
          tokenValue(page, "color", "var(--fs-popup-text-2)"),
        ]);

        expect.soft(colours.glyphSize, "the glyph's box").toEqual([16, 16]);
        expect.soft(colours.radius, "the control radius").toBe("10px");
        expect.soft(colours.enters, "enters with fs-enter").toBe(enters);
        if (surface) {
          expect.soft(colours.surface, "a tinted surface").not.toBe("transparent");
          expect.soft(colours.text, "the sentence in ink").toBe(ink);
          expect.soft(colours.glyph, "the glyph in the tone's text colour").toBe(tint);
          expect.soft(contrast(colours.glyph, colours.under), "the glyph on its surface").toBeGreaterThanOrEqual(3);
        } else {
          expect.soft(colours.surface, "no surface").toBe("transparent");
          expect.soft(colours.text, "the note in the secondary text").toBe(ink2);
        }
        expect.soft(contrast(colours.text, colours.under), "the sentence on its surface").toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

test.describe("the bottom half's spacing", () => {
  for (const { width, height, title, detail, row } of [
    { width: 1280, height: 800, title: "600 13px/18px", detail: "400 12px/16px", row: 36 },
    { width: 375, height: 812, title: "600 13px/16px", detail: "400 12px/16px", row: 40 },
    { width: 375, height: 667, title: "600 13px/16px", detail: "400 12px/16px", row: 40 },
  ]) {
    test(`sets the steps in ${title} over ${detail} in ${row}px rows, and the callout 8px over the button, at ${width} x ${height}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      const dialog = await openPopup(page, 2, "failed", "reverted");
      await expect(dialog.getByTestId("status-text")).not.toBeEmpty();
      const measured = await dialog.evaluate((element) => {
        const font = (node: Element) => {
          const style = getComputedStyle(node);
          return `${style.fontWeight} ${style.fontSize}/${style.lineHeight}`;
        };
        const rows = [...element.querySelectorAll(".predict-steps > li")];
        const box = element.querySelector("[data-testid=status-box]")!.getBoundingClientRect();
        const cta = element.querySelector(".predict-footer > .predict-cta")!.getBoundingClientRect();
        return {
          titles: [...new Set(rows.map((row) => font(row.querySelector("h2")!)))],
          details: [...new Set(rows.map((row) => font(row.querySelector("h2 + p")!)))],
          rows: [rows[0], rows[2]].map(
            (row) => row!.querySelector(":scope > div:nth-child(2)")!.getBoundingClientRect().height,
          ),
          calloutToButton: Math.round(cta.top - box.bottom),
        };
      });

      expect.soft(measured.titles, "step titles").toEqual([title]);
      expect.soft(measured.details, "step details").toEqual([detail]);
      expect.soft(measured.rows, "the first and last rows").toEqual([row, row]);
      expect.soft(measured.calloutToButton, "the callout to the button").toBe(8);
    });
  }
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

test.describe("the amount panel's tint", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  for (const theme of ["light", "dark"]) {
    test(`is one even linear tint along the axis, with no corner hotspot, in the ${theme} theme`, async ({ page }) => {
      await openHarness(page, `${harness.url}?options=2&theme=${theme}`);
      const image = await page
        .locator("[data-panel=amount]")
        .evaluate((panel) => getComputedStyle(panel).backgroundImage);

      expect(image.match(/linear-gradient/g)).toHaveLength(1);
      expect(image).not.toContain("radial-gradient");
      // a color-mix() stop computes to color(srgb r g b / alpha)
      const alphas = [...image.matchAll(/color\(srgb [\d.]+ [\d.]+ [\d.]+ \/ ([\d.]+)\)/g)].map((match) =>
        Number(match[1]),
      );
      expect(alphas).toEqual(theme === "dark" ? [0.14, 0.1] : [0.06, 0.06]);
    });
  }
});

test.describe("the price check before a run", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("says Checking prices… on the summary and the button while every step waits", async ({ page }) => {
    const dialog = await openPopup(page, 2, "quoting");

    await expect(dialog.locator('[data-bullet="running"]')).toHaveCount(0);
    await expect(dialog.getByTestId("predict-summary").getByRole("button").first()).toHaveText("Checking prices…");
    await expect(dialog.locator(".predict-footer > .predict-cta")).toHaveText("Checking prices…");
    const rows = dialog.getByRole("listitem", { name: /^Timeline item/ });
    await expect(rows).toHaveCount(3);
    const subtitles = await rows.evaluateAll((items) =>
      Object.fromEntries(
        items.map((item) => [item.querySelector("h2")?.textContent, item.querySelector("h2 + p")?.textContent ?? ""]),
      ),
    );
    // only the funds row names something, the amount it adds; no row says it is waiting
    expect(subtitles).toMatchObject({ "Create a trade wallet": "", "Place prediction": "" });
    expect(Object.values(subtitles).join(" ")).not.toContain("…");
  });

  test("travels linearly and is widest mid-track, by transform alone, after a delay a quick quote ends within", async ({
    page,
  }) => {
    const dialog = await openPopup(page, 2, "quoting");
    const sweep = await dialog.locator("[data-testid=pricing-sweep] > i").evaluate((node) => {
      const properties = (animations: Animation[]) => [
        ...new Set(
          animations
            .flatMap((animation) => (animation.effect as KeyframeEffect).getKeyframes())
            .flatMap((frame) => Object.keys(frame))
            .filter((key) => !["offset", "easing", "composite", "computedOffset"].includes(key)),
        ),
      ];
      const all = node.getAnimations({ subtree: true });
      const bar = all.filter((animation) => (animation.effect as KeyframeEffect).pseudoElement === "::before");
      const easings = all.flatMap((animation) =>
        (animation.effect as KeyframeEffect).getKeyframes().map((frame) => frame.easing),
      );
      const widest = bar[0] && (bar[0].effect as KeyframeEffect).getKeyframes().find((frame) => frame.offset === 0.5);
      return {
        easings: [...new Set(easings)],
        delays: all.map((animation) => (animation.effect as KeyframeEffect).getTiming().delay),
        widest: widest?.transform,
        names: all.map((animation) => (animation as CSSAnimation).animationName).sort(),
        properties: properties(all),
        barProperties: properties(bar),
      };
    });

    expect(sweep.names).toEqual(["predict-sweep-stretch", "predict-sweep-travel"]);
    expect(sweep.properties).toEqual(["transform"]);
    expect(sweep.barProperties).toEqual(["transform"]);
    expect(sweep.easings).toEqual(["linear"]);
    expect(sweep.delays).toEqual([250, 250]);
    // the travel is linear, so halfway through the loop the bar's centre is the track's
    expect(sweep.widest).toBe("scaleX(0.6)");
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
      await expect(dialog.locator(".predict-footer > .predict-cta")).toHaveAttribute("data-busy");
      const animations = await dialog
        .locator("li, li *, button svg, [data-testid=predict-spinner]")
        .evaluateAll((items) => items.map((item) => getComputedStyle(item).animationName));

      expect(animations.every((name) => name === "none")).toBe(true);
      if (state === "quoting") {
        // the line pulses its opacity in place, so it does not read as a finished divider
        const line = await dialog.locator("[data-testid=pricing-sweep] > i").evaluate((node) => ({
          name: getComputedStyle(node).animationName,
          transform: getComputedStyle(node).transform,
          bar: getComputedStyle(node, "::before").animationName,
          properties: [
            ...new Set(
              node
                .getAnimations()
                .flatMap((animation) => (animation.effect as KeyframeEffect).getKeyframes())
                .flatMap((frame) => Object.keys(frame))
                .filter((key) => !["offset", "easing", "composite", "computedOffset"].includes(key)),
            ),
          ],
        }));
        expect(line).toEqual({ name: "predict-sweep-pulse", transform: "none", bar: "none", properties: ["opacity"] });
      }
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

test.describe("an inactive step", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  /** Each inactive row's title, detail and digit as painted: colour blended by every ancestor's opacity over the first opaque fill. */
  const painted = (dialog: Locator) =>
    dialog.locator('.predict-steps > li:has([data-bullet="inactive"])').evaluateAll((rows) =>
      rows.flatMap((row) =>
        [row.querySelector("h2"), row.querySelector("h2 + p"), row.querySelector('[data-glyph="digit"]')]
          .filter((node): node is Element => node !== null && node.textContent!.trim() !== "")
          .map((node) => {
            const channels = (css: string) => css.match(/[\d.]+/g)!.map(Number);
            let alpha = 1;
            let fill: number[] | undefined;
            // an opacity above the fill fades text and ground alike
            for (let at: Element | null = node; at && !fill; at = at.parentElement) {
              alpha *= Number(getComputedStyle(at).opacity);
              const [r = 0, g = 0, b = 0, a = 1] = channels(getComputedStyle(at).backgroundColor);
              if (a === 1) fill = [r, g, b];
            }
            const [r = 0, g = 0, b = 0, a = 1] = channels(getComputedStyle(node).color);
            const ground = fill ?? [255, 255, 255];
            const mix = [r, g, b].map((c, i) => Math.round(c * a * alpha + ground[i]! * (1 - a * alpha)));
            return {
              text: node.textContent!.trim(),
              color: `rgb(${mix.join(", ")})`,
              ground: `rgb(${ground.join(", ")})`,
            };
          }),
      ),
    );

  for (const theme of ["light", "dark"]) {
    for (const [state, extra] of [
      ["idle", "&first=0"],
      ["over", ""],
      ["disconnected", ""],
      ["pending", ""],
    ] as const) {
      test(`stays dimmer than a step that will run, its words and digit at 4.5:1 or more, ${state}${extra} in the ${theme} theme`, async ({
        page,
      }) => {
        const dialog = await openPopup(page, 2, state, undefined, `${extra}&theme=${theme}`);
        const rows = await painted(dialog);
        expect(rows.length, "an inactive step is shown").toBeGreaterThan(0);
        const full = await tokenValue(page, "color", "var(--fs-popup-text)");
        for (const { text, color, ground } of rows) {
          expect.soft(contrast(color, ground), `"${text}" on ${ground}`).toBeGreaterThanOrEqual(4.5);
          expect
            .soft(contrast(color, ground), `"${text}" dimmer than a running title`)
            .toBeLessThan(contrast(full, ground));
        }
      });
    }
  }
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

test.describe("the popup's type roles", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("give way to a weight utility beside them, in the panels and the settings", async ({ page }) => {
    const weightOf = (locator: Locator) => locator.evaluate((element) => getComputedStyle(element).fontWeight);
    const dialog = await openPopup(page, 2);
    expect.soft(await weightOf(dialog.getByRole("heading", { name: "2 estimates" })), "2 estimates").toBe("500");
    expect.soft(await weightOf(dialog.getByRole("heading", { name: /^You pay/ })), "You pay").toBe("500");
    expect
      .soft(await weightOf(dialog.getByTestId("predict-summary").getByRole("button").first()), "the Details row")
      .toBe("500");

    await openHarness(page, `${harness.url}?options=2&settings=open`);
    const settings = page.getByRole("dialog");
    await expect(settings.getByRole("button", { name: "Done" })).toBeVisible();
    expect.soft(await weightOf(settings.getByRole("heading", { name: "Max slippage" })), "Max slippage").toBe("500");
    expect.soft(await weightOf(settings.getByRole("button", { name: "Done" })), "Done").toBe("600");
  });
});

test.describe("the popup's numbers", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("set the balance and the estimates count in tabular figures beside a type role", async ({ page }) => {
    const dialog = await openPopup(page, 10);
    for (const number of [dialog.getByText(/^Balance:/), dialog.getByText(/^10 estimates$/)]) {
      await expect(number).toHaveCSS("font-variant-numeric", "tabular-nums");
    }
  });
});

/** Each figure in the open summary: true when nothing of it is cut and it sits inside its row. */
function figuresShownWhole(dialog: Locator) {
  return dialog
    .getByTestId("predict-summary")
    .locator('[data-testid="trade-leg"], [data-testid="trade-mint"] > span, [data-testid="market-move"]')
    .evaluateAll((figures) =>
      figures.map((figure) => {
        const row = figure.closest("li, p")!.getBoundingClientRect();
        const box = figure.getBoundingClientRect();
        return {
          text: figure.textContent,
          whole:
            figure.scrollWidth <= figure.clientWidth + 1 &&
            box.left >= row.left - 0.5 &&
            box.right <= row.right + 0.5 &&
            box.bottom <= row.bottom + 0.5,
        };
      }),
    );
}

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 375, height: 667 },
]) {
  test.describe(`the trades in the summary at ${viewport.width} x ${viewport.height}`, () => {
    test.use({ viewport });

    test("lists the mint, each option's legs on its connector and the closing note, every figure whole", async ({
      page,
    }, testInfo) => {
      const dialog = await openPopup(page, 2);
      await openSummary(dialog);
      const summary = dialog.getByTestId("predict-summary");

      expect(await summary.getByTestId("trade-mint").evaluate((mint) => mint.textContent!.replace(/\s+/g, " "))).toBe(
        "Mint10 sDAI → 10 tokens of every city",
      );
      for (const name of ["Berlin", "Lisbon metropolitan area"]) {
        const legs = summary.getByRole("list", { name: `Trades for ${name}` });
        await expect(legs.getByRole("listitem").first()).toHaveText(/^Split.*\+.*held/);
        await expect(legs).toHaveCSS("border-left-style", "dotted");
        await expect(legs).toHaveCSS("border-left-width", "1px");
        expect(await legs.getByRole("listitem").count(), `${name}'s legs`).toBeGreaterThanOrEqual(2);
        // the type-label role sets 14/20 in the legs, with 3px above and below
        expect((await legs.getByRole("listitem").last().boundingBox())!.height, "a one-line leg").toBe(26);
      }
      await expect(summary.getByTestId("trades-note")).toBeVisible();
      for (const figure of await figuresShownWhole(dialog)) expect.soft(figure.whole, figure.text!).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);

      await summary.getByTestId("trades-note").scrollIntoViewIfNeeded();
      await testInfo.attach(`trades-${viewport.width}x${viewport.height}`, {
        body: await page.screenshot(),
        contentType: "image/png",
      });
    });

    test("wraps seven-digit figures under themselves, truncates a long name and says which option is left out", async ({
      page,
    }, testInfo) => {
      const dialog = await openPopup(page, 2, "idle", undefined, "&trades=worst");
      await openSummary(dialog);
      const summary = dialog.getByTestId("predict-summary");

      expect(await summary.getByTestId("trade-mint").evaluate((mint) => mint.textContent!.replace(/\s+/g, " "))).toBe(
        "Mint1,234,567.89 sDAI → 1,234,567.89 tokens of every city",
      );
      const name = summary.getByTitle(/^Greater Lisbon/);
      expect(await name.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
      await expect(summary.getByRole("list", { name: "Trades for Lisbon metropolitan area" })).toHaveText(
        "No tradeAlready at your estimate; left out",
      );
      for (const figure of await figuresShownWhole(dialog)) expect.soft(figure.whole, figure.text!).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);

      await testInfo.attach(`trades-worst-${viewport.width}x${viewport.height}`, {
        body: await page.screenshot(),
        contentType: "image/png",
      });
    });
  });
}

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
    const head = dialog.getByTestId("predict-summary").getByRole("button").first();
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
        { name: "rotate", duration: 250, delay: 0 },
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

/** WCAG contrast between two computed rgb() colours. */
function contrast(first: string, second: string) {
  const luminance = (css: string) => {
    const [r = 0, g = 0, b = 0] = css.match(/[\d.]+/g)!.map(Number);
    const linear = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  };
  const [a, b] = [luminance(first), luminance(second)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

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

  test("names the email in one sentence, links to Settings in the accent, and rings its mark in the panel's tone", async ({
    page,
  }) => {
    await openHarness(page, `${harness.url}?options=2&state=success&dialog=success`);
    const dialog = page.getByRole("dialog", { name: "Prediction placed" });
    const link = dialog.getByRole("link", { name: "Change in Settings" });

    await expect(dialog.getByText("2 estimates · 10 sDAI")).toBeVisible();
    await expect(dialog.getByText(/^You'll get an email at/)).toHaveText(
      "You'll get an email at visitor@example.com when the market resolves.",
    );
    await expect(dialog.getByRole("textbox")).toHaveCount(0);
    await expect(link).toHaveAttribute("href", "/settings?tab=notifications");
    await expect(link).toHaveCSS("color", await tokenValue(page, "color", "var(--fs-popup-accent-text)"));
    await expect(dialog.getByText("Confirm your email first", { exact: false })).toHaveCount(0);
    const ring = await page.getByTestId("success-mark").evaluate((mark) => getComputedStyle(mark).boxShadow);
    expect(ring).toContain(await tokenValue(page, "color", "var(--fs-popup-panel)"));
  });

  test("groups the title, the panel and the action 24 and 16 apart", async ({ page }) => {
    await openHarness(page, `${harness.url}?options=2&state=success&dialog=success`);
    const dialog = page.getByRole("dialog", { name: "Prediction placed" });
    const title = (await dialog.getByText("2 estimates · 10 sDAI").boundingBox())!;
    const panel = (await dialog.locator("section").boundingBox())!;
    const close = (await dialog.getByRole("button", { name: "Close" }).boundingBox())!;

    expect(Math.round(panel.y - (title.y + title.height))).toBe(24);
    expect(Math.round(close.y - (panel.y + panel.height))).toBe(16);
  });

  test("warns in the warning tone when the email is not confirmed", async ({ page }) => {
    await openHarness(page, `${harness.url}?options=2&state=success&dialog=success&verified=0`);
    const warning = page.getByText("Confirm your email first, or it will not arrive.");

    await expect(warning).toBeVisible();
    await expect(warning).toHaveCSS("color", await tokenValue(page, "color", "var(--fs-tone-warning-text)"));
    await expect(page.getByRole("link", { name: "Confirm in Settings" })).toHaveAttribute(
      "href",
      "/settings?tab=notifications",
    );
  });

  test("keeps the sign-in at 44px in the panel and Close as a 44px text action", async ({ page }) => {
    await openHarness(page, `${harness.url}?options=2&state=success&dialog=success&subscribed=0`);
    const dialog = page.getByRole("dialog", { name: "Prediction placed" });
    const signIn = dialog.locator("section").getByRole("button", { name: "Sign in to subscribe" });
    const close = dialog.getByRole("button", { name: "Close" });

    expect((await signIn.boundingBox())!.height).toBe(44);
    await expect(signIn).toHaveCSS(
      "border-top-left-radius",
      await tokenValue(page, "borderRadius", "var(--fs-radius-control)"),
    );
    expect((await close.boundingBox())!.height).toBe(44);
    await expect(close).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(dialog.locator(".predict-cta")).toHaveCount(1);
  });

  for (const theme of ["light", "dark"]) {
    test(`rings its buttons in the popup's violet when reached by keyboard, in the ${theme} theme`, async ({
      page,
    }) => {
      await openHarness(page, `${harness.url}?options=2&state=success&dialog=success&subscribed=0&theme=${theme}`);
      const dialog = page.getByRole("dialog", { name: "Prediction placed" });
      const accent = await tokenValue(page, "color", "var(--fs-popup-accent)");
      for (const name of ["Sign in to subscribe", "Close"]) {
        const button = dialog.getByRole("button", { name });
        for (
          let step = 0;
          step < 6 && !(await button.evaluate((element) => element === document.activeElement));
          step++
        ) {
          await page.keyboard.press("Tab");
        }
        await expect(button).toBeFocused();
        await settle(dialog);
        await expect(button).toHaveCSS("outline-color", accent);
        await expect(button).toHaveCSS("outline-style", "solid");
        expect(await button.evaluate((element) => /\d+px [1-9]/.test(getComputedStyle(element).boxShadow))).toBe(false);
      }
    });
  }

  for (const theme of ["light", "dark"]) {
    test(`offers the sign-in on the popup's axis, its label at 4.5:1 or more at both ends, in the ${theme} theme`, async ({
      page,
    }) => {
      await openHarness(page, `${harness.url}?options=2&state=success&dialog=success&subscribed=0&theme=${theme}`);
      const signIn = page.getByRole("dialog", { name: "Prediction placed" }).getByRole("button", {
        name: "Sign in to subscribe",
      });
      const ends = [
        await tokenValue(page, "color", "var(--fs-popup-axis-from)"),
        await tokenValue(page, "color", "var(--fs-popup-axis-to)"),
      ];
      const look = await signIn.evaluate((button) => ({
        fill: getComputedStyle(button).backgroundImage,
        label: getComputedStyle(button.querySelector(".button-text")!).color,
      }));
      for (const end of ends) expect(look.fill).toContain(end);
      expect(look.label).toBe(await tokenValue(page, "color", "var(--fs-popup-on-axis)"));
      for (const end of ends) expect.soft(contrast(look.label, end), `on ${end}`).toBeGreaterThanOrEqual(4.5);
    });

    test(`keeps the sign-in's label at 4.5:1 or more beside a spinner while the wallet signs, in the ${theme} theme`, async ({
      page,
    }) => {
      await openHarness(
        page,
        `${harness.url}?options=2&state=success&dialog=success&subscribed=0&signin=busy&theme=${theme}`,
      );
      const signIn = page.getByRole("dialog", { name: "Prediction placed" }).getByRole("button", {
        name: "Signing in…",
      });
      await expect(signIn).toHaveAttribute("data-busy", "true");
      await expect(signIn.getByTestId("predict-spinner")).toBeVisible();
      const look = await signIn.evaluate((button) => {
        const label = getComputedStyle(button.querySelector(".button-text")!);
        return { visibility: label.visibility, label: label.color, fill: getComputedStyle(button).backgroundColor };
      });
      expect(look.visibility).toBe("visible");
      expect(contrast(look.label, look.fill)).toBeGreaterThanOrEqual(4.5);
    });
  }

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
      dialog.getByTestId("predict-summary").getByRole("button").first(),
    ]) {
      await control.hover();
      await expect(control).toHaveCSS("background-color", "rgb(46, 32, 108)");
    }
  });
});

test.describe("an estimate removed from the popup", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("fades and shrinks its row by opacity and scale while its height folds, drawing the rows below up", async ({
    page,
  }) => {
    const dialog = await openPopup(page, 3);
    const row = dialog.getByRole("listitem").first();
    const next = dialog.getByRole("listitem").nth(1);
    const name = await row.locator("[title]").getAttribute("title");
    const top = () => next.evaluate((element) => element.getBoundingClientRect().top);
    const before = await top();

    await dialog.getByRole("button", { name: `Remove ${name}` }).click();
    const moving = await row.evaluate((element) =>
      element.getAnimations().map((animation) => {
        animation.pause();
        animation.currentTime = 50;
        return (animation as CSSTransition).transitionProperty;
      }),
    );
    expect(moving).toEqual(expect.arrayContaining(["opacity", "scale", "height"]));
    const halfway = await top();
    expect(halfway).toBeLessThan(before - 4);
    expect(halfway).toBeGreaterThan(before - 28);
  });
});
