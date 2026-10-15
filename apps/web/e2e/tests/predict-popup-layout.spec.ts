import { expect, test, type Locator, type Page } from "@playwright/test";

import { startHarness } from "../utils/component-harness";

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

async function openPopup(
  page: Page,
  options: number,
  state: (typeof STATES)[number] = "idle",
  reason?: string,
  extra = "",
) {
  await page.goto(`${harness.url}?options=${options}&state=${state}${reason ? `&reason=${reason}` : ""}${extra}`);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--fs-accent"));
  expect(accent.trim(), "the harness loads Foresight's token layer").not.toBe("");
  await expect(
    dialog.getByRole("listitem").filter({ has: page.getByRole("img", { name: /the market$/ }) }),
  ).toHaveCount(options);
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
  return dialog;
}

/** The boxes a state change must not move: the dialog, its footer, and the scrolled body's full height. */
async function footprint(page: Page, dialog: Locator) {
  const box = (await dialog.boundingBox())!;
  const cancel = (await dialog.getByRole("button", { name: "Cancel" }).boundingBox())!;
  const body = await page.getByTestId("predict-body").evaluate((element) => element.getBoundingClientRect().height);
  const bullet = (await dialog.locator("ol [data-bullet]").first().boundingBox())!;
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    dialog: [box.x, box.y, box.width, box.height].map(round),
    footer: [cancel.x, cancel.y].map(round),
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

        const barTop = Math.min(
          ...(await Promise.all(
            ["Cancel", "Predict"].map(async (name) => (await dialog.getByRole("button", { name }).boundingBox())!.y),
          )),
        );
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

      test("keeps one footprint and its footer in place in every state, inside the window", async ({
        page,
      }, testInfo) => {
        const pageErrors: string[] = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));

        const idleDialog = await openPopup(page, options, "idle");
        const idle = await footprint(page, idleDialog);
        // the spine fits the window: every step is in view as the popup opens, with nothing to scroll to
        for (const title of STEPS) {
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
            ? [dialog.getByRole("button", { name: "Max" }), dialog.getByRole("button", { name: /sDAI/ })]
            : []) {
            expect
              .soft(await isFullyShown(control), `${state}: ${await control.textContent()} is reachable`)
              .toBe(true);
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

        if (testInfo.errors.length > 0 || viewport.width !== 1280 || options !== 2) return;
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
      const overflows = await scroller.evaluate((element) => element.scrollHeight >= element.clientHeight + 16);

      if (overflows) {
        await expect(cue).toHaveCSS("opacity", "1");
        expect(await cue.evaluate((element) => getComputedStyle(element).pointerEvents)).toBe("none");
        await scroller.evaluate((element) => element.scrollTo(0, element.scrollHeight));
      }
      await expect(cue).toHaveCSS("opacity", "0");
    });
  }

  // the cut row and its fade say there is more; four rows on a wide popup would overflow by a fade's worth for nothing
  for (const [width, height, options, rows] of [
    [1280, 800, 10, 3.5],
    [1280, 800, 4, 4],
    [375, 667, 10, 3],
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
    });
  }
});

test.describe("a popup on a short screen", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("leaves out the share slider and keeps a two-line status slot", async ({ page }) => {
    const dialog = await openPopup(page, 2, "failed", "funds");

    await expect(dialog.getByTestId("amount-slider")).toBeHidden();
    expect((await dialog.getByRole("status").boundingBox())!.height).toBeLessThanOrEqual(40);
  });
});

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

test.describe("an amount over a four-digit balance at 375 x 812", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("shows the balance and its token whole, and keeps the slider's 100% on the track", async ({ page }) => {
    await page.goto(`${harness.url}?options=2&state=over&held=6833.959612`);
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

    const label = dialog.locator("#slider-label");
    await expect(label).toHaveText("100%");
    const [labelBox, track] = await Promise.all([label.boundingBox(), dialog.locator("#slider-track").boundingBox()]);
    expect(labelBox!.x).toBeGreaterThanOrEqual(track!.x);
    expect(labelBox!.x + labelBox!.width).toBeLessThanOrEqual(track!.x + track!.width);
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

  test("keeps the running step and the loading Predict still", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const dialog = await openPopup(page, 2, "signing");
    const animations = await dialog
      .locator("li, li *, button svg")
      .evaluateAll((items) => items.map((item) => getComputedStyle(item).animationName));

    expect(animations.every((name) => name === "none")).toBe(true);
  });
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

  // the accent mixed 55 % toward the secondary text in light and toward the border in dark
  for (const [theme, fill] of [
    ["light", [88, 111, 188]],
    ["dark", [65, 82, 192]],
  ] as const) {
    test(`is a greyed blue with its white label at 3:1 or more in the ${theme} theme`, async ({ page }) => {
      await page.goto(`${harness.url}?options=2&state=over&theme=${theme}`);
      const predict = page.getByRole("dialog").getByRole("button", { name: "Predict" });
      await expect(predict).toBeDisabled();

      const shown = await readFill(predict);
      expect(shown.alpha).toBe(1);
      expect(shown.opacity).toBe(1);
      shown.fill.forEach((channel, index) => expect.soft(Math.abs(channel - fill[index]!)).toBeLessThanOrEqual(2));
      expect(shown.ratio).toBeGreaterThanOrEqual(3);
    });
  }

  test("dims Max to the secondary text while it cannot be pressed", async ({ page }) => {
    const dialog = await openPopup(page, 2, "signing");
    const max = dialog.getByRole("button", { name: "Max" });
    await expect(max).toBeDisabled();

    const [label, secondary] = await Promise.all([
      max.locator(".button-text").evaluate((element) => getComputedStyle(element).color),
      dialog.evaluate((element) => {
        const probe = element.ownerDocument.createElement("span");
        probe.className = "text-fs-text-secondary";
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
    await page.goto(`${harness.url}?options=2&state=idle&theme=dark`);
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

test.describe("the spine's line", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  /** The accent fill over each connector, top to bottom: true where it is drawn. */
  const fills = (dialog: Locator) =>
    dialog
      .locator(".spine-line, .predict-spine > li > div:first-child > div:last-child")
      .evaluateAll((lines) =>
        lines.map((line) => getComputedStyle(line, "::after").transform === "matrix(1, 0, 0, 1, 0, 0)"),
      );

  test("is unfilled at rest, and fills under each node and step that has finished", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await fills(await openPopup(page, 2, "idle"))).toEqual([false, false, false, false]);

    // the estimates, the amount and the trade wallet are done; adding funds is running
    expect(await fills(await openPopup(page, 2, "signing"))).toEqual([true, true, true, false]);
  });

  test("shows the check of a finished step and the cross of a failed one, each glyph alone", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const dialog = await openPopup(page, 2, "failed");
    const shown = (view: string) =>
      dialog
        .locator(`[data-bullet="${view}"]`)
        .first()
        .locator("svg")
        .evaluateAll((glyphs) =>
          glyphs.filter((glyph) => getComputedStyle(glyph).opacity === "1").map((glyph) => glyph.dataset.glyph),
        );

    expect(await shown("done")).toEqual(["check"]);
    expect(await shown("failed")).toEqual(["cross"]);
  });
});
