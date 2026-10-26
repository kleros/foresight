import { expect, test, type Page } from "@playwright/test";

import { PIN_PREFLIGHT_DROP } from "../../src/features/predict/utils/marketPin";
import { openHarness, startHarness } from "../utils/component-harness";

/** The slider's track in an option card: 375 and 1280 wide windows. */
const TRACKS = [311, 1112];
/** The track at 320 and 360 wide. */
const PHONE_TRACKS = [256, 296];
const MARKET = 75;

let harness: Awaited<ReturnType<typeof startHarness>>;

test.beforeAll(async () => {
  harness = await startHarness("estimate-slider");
});

test.afterAll(async () => {
  await harness?.close();
});

type Box = { left: number; top: number; right: number; bottom: number };

async function open(page: Page, query: Record<string, string | number>) {
  const search = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
  await openHarness(page, `${harness.url}?${search}`);
  await expect(page.getByTestId("market-chip")).toBeVisible();
}

const settle = (page: Page) =>
  page
    .evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    .then(() => page.waitForFunction(() => document.getAnimations().length === 0));

/** Where everything the pin can collide with is drawn, in page px, once it has settled. */
async function geometry(page: Page) {
  await settle(page);
  return page.evaluate(() => {
    const box = (element: Element | null): Box | null => {
      if (!element) return null;
      const { left, top, right, bottom } = element.getBoundingClientRect();
      return { left, top, right, bottom };
    };
    const pin = document.querySelector<HTMLElement>('[data-testid="market-pin"]')!;
    const bound = (side: string) => document.querySelector<HTMLElement>(`[data-bound="${side}"]`)!;
    return {
      placement: pin.dataset.placement,
      drop: Number(pin.dataset.drop),
      chip: box(pin.querySelector('[data-testid="market-chip"]')),
      stick: box(pin.querySelector('[data-testid="market-stick"]')),
      pill: box(document.querySelector('[data-testid="value-pill"]')),
      thumb: box(document.querySelector("#slider-label")!.parentElement),
      track: box(document.querySelector("#slider-track")),
      lower: { box: box(bound("lower")), hidden: getComputedStyle(bound("lower")).visibility === "hidden" },
      upper: { box: box(bound("upper")), hidden: getComputedStyle(bound("upper")).visibility === "hidden" },
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

const overlaps = (a: Box | null, b: Box | null) =>
  a !== null && b !== null && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

for (const track of TRACKS) {
  test.describe(`the market pin on a ${track}px track`, () => {
    // the pin's moves are transitions; geometry is read where they land
    test.use({ viewport: { width: track + 64, height: 400 }, contextOptions: { reducedMotion: "reduce" } });

    test("sits under the track with no estimate set, the pill showing the market's number", async ({ page }) => {
      await open(page, { track, market: MARKET });
      const shown = await geometry(page);

      expect(shown.placement).toBe("down");
      await expect(page.getByTestId("value-pill")).toHaveText(`${MARKET} %`);
    });

    test("never draws the chip over the pill or the thumb, nor the stick through the pill, from 0 to 100", async ({
      page,
    }) => {
      await open(page, { track, market: MARKET, value: 0 });
      const slider = page.getByRole("slider");
      await slider.focus();
      for (let value = 0; value <= 100; value++) {
        if (value > 0) await slider.press("ArrowRight");
        const shown = await geometry(page);
        expect.soft(overlaps(shown.chip, shown.pill), `chip over the pill at ${value}`).toBe(false);
        expect.soft(overlaps(shown.chip, shown.thumb), `chip over the thumb at ${value}`).toBe(false);
        expect.soft(overlaps(shown.stick, shown.pill), `stick through the pill at ${value}`).toBe(false);
        expect.soft(shown.pill!.left, `pill's left edge at ${value}`).toBeGreaterThanOrEqual(shown.track!.left - 0.5);
        expect.soft(shown.pill!.right, `pill's right edge at ${value}`).toBeLessThanOrEqual(shown.track!.right + 0.5);
        for (const side of ["lower", "upper"] as const) {
          const bound = shown[side];
          // a bound steps aside only for a dropped chip that sits on it
          expect
            .soft(bound.hidden, `${side} bound at ${value}`)
            .toBe(shown.placement === "down" && overlaps(shown.chip, bound.box));
        }
      }
    });

    test("dips the chip as the value nears it, keeping it above the track, before it drops", async ({ page }) => {
      await open(page, { track, market: MARKET, value: 0 });
      const slider = page.getByRole("slider");
      await slider.focus();
      const raisedTop = (await geometry(page)).chip!.top;

      const dips: number[] = [];
      for (let value = 1; value <= MARKET; value++) {
        await slider.press("ArrowRight");
        const shown = await geometry(page);
        if (shown.placement === "down") break;
        if (shown.drop > 0) {
          dips.push(shown.drop);
          expect.soft(shown.chip!.top, `chip dipped at ${value}`).toBeGreaterThan(raisedTop);
          expect.soft(shown.chip!.bottom, `chip above the track at ${value}`).toBeLessThanOrEqual(shown.track!.top);
        }
      }

      expect(dips.length, "steps in the preflight dip").toBeGreaterThan(1);
      expect(dips, "the dip deepens as the value nears").toEqual([...dips].sort((a, b) => a - b));
      expect(Math.max(...dips)).toBeLessThanOrEqual(PIN_PREFLIGHT_DROP);
      await expect(page.getByTestId("market-pin")).toHaveAttribute("data-placement", "down");
    });

    for (const market of [0, 2, 98, 100]) {
      test(`keeps the chip on the track with the market at ${market}`, async ({ page }) => {
        for (const value of [undefined, market, 50]) {
          await open(page, { track, market, ...(value === undefined ? {} : { value }) });
          const shown = await geometry(page);

          expect.soft(shown.chip!.left, "chip's left edge").toBeGreaterThanOrEqual(shown.track!.left - 0.5);
          expect.soft(shown.chip!.right, "chip's right edge").toBeLessThanOrEqual(shown.track!.right + 0.5);
          expect.soft(shown.overflow, "the page scrolls sideways").toBe(0);
          for (const side of ["lower", "upper"] as const) {
            expect
              .soft(shown[side].hidden, `${side} bound with the estimate at ${value ?? "none"}`)
              .toBe(shown.placement === "down" && overlaps(shown.chip, shown[side].box));
          }
        }
      });
    }

    for (const [name, query] of [
      ["a millions scale", { market: 3250000, upper: 5000000, unit: "$M" }],
      ["a percent scale near its top", { market: 85 }],
      ["a percent scale near its bottom", { market: 15 }],
    ] as const) {
      test(`names both ends of ${name} beside a dropped chip`, async ({ page }) => {
        await open(page, { track, ...query });
        const shown = await geometry(page);

        expect(shown.placement).toBe("down");
        for (const side of ["lower", "upper"] as const) {
          expect.soft(shown[side].hidden, `${side} bound hidden`).toBe(false);
          expect.soft(overlaps(shown.chip, shown[side].box), `chip over the ${side} bound`).toBe(false);
        }
      });
    }

    test("never draws the chip over the open field as the value nears the market", async ({ page }) => {
      await open(page, { track, market: MARKET, value: 40 });
      const slider = page.getByRole("slider");
      const pill = page.getByRole("button", { name: "type your estimate for Movie A" });
      for (let value = 41; value < MARKET; value++) {
        await slider.focus();
        await slider.press("ArrowRight");
        await pill.click();
        const shown = await geometry(page);
        expect.soft(overlaps(shown.chip, shown.pill), `chip over the open field at ${value}`).toBe(false);
        await page.getByRole("textbox").press("Escape");
      }
    });

    test("moves the pin only when the committed value changes, not as the pill opens or takes typing", async ({
      page,
    }) => {
      // a raised chip in its dip, where a wider pill would drop it
      const value = track === 311 ? 54 : 69;
      await open(page, { track, market: MARKET, value });
      const pin = async () => {
        const { placement, drop } = await geometry(page);
        return { placement, drop };
      };
      const field = page.getByRole("textbox");
      const resting = await pin();
      expect(resting.drop, "the pin rests in its dip").toBeGreaterThan(0);
      expect(resting.drop).toBeLessThan(1);
      const closed = (await geometry(page)).pill!;

      await page.getByRole("button", { name: "type your estimate for Movie A" }).click();
      expect.soft(await pin(), "the field opened").toEqual(resting);
      for (const typed of ["5", "55", "5555", "5555555", "555555555", "55555555555555"]) {
        await field.fill(typed);
        expect.soft(await pin(), `"${typed}" typed`).toEqual(resting);
        const { pill } = await geometry(page);
        expect
          .soft(pill!.right - pill!.left, `the field's width with "${typed}"`)
          .toBeGreaterThanOrEqual(closed.right - closed.left - 0.5);
      }
      await field.press("Escape");
      expect.soft(await pin(), "Escape").toEqual(resting);

      await page.getByRole("button", { name: "type your estimate for Movie A" }).click();
      await field.fill(String(value));
      await field.press("Enter");
      expect.soft(await pin(), "the same value committed").toEqual(resting);
    });

    test("takes a press 9px above the thumb's circle, inside its 44px target, as the thumb's, and one just above the pill as the pill's", async ({
      page,
    }) => {
      await open(page, { track, market: MARKET, value: 20 });
      const { thumb, pill } = await geometry(page);
      const hits = await page.evaluate(
        (points) => {
          const thumb = document.querySelector("#slider-label")!.parentElement!;
          const pill = document.querySelector('[data-testid="value-pill"] button')!;
          const [above, overPill] = points.map(([x, y]) => document.elementFromPoint(x!, y!));
          return [thumb.contains(above!), pill.contains(overPill!)];
        },
        [
          // the target reaches 10px past the 24px circle; the pill's foot lies over that band
          [(thumb!.left + thumb!.right) / 2, thumb!.top - 9],
          [(pill!.left + pill!.right) / 2, pill!.top - 6],
        ],
      );

      expect(hits).toEqual([true, true]);
    });

    test("takes a press 9px beside the thumb as the thumb's", async ({ page }) => {
      await open(page, { track, market: MARKET, value: 50 });
      const { thumb } = await geometry(page);
      const middle = (thumb!.top + thumb!.bottom) / 2;
      const hits = await page.evaluate(
        (points) =>
          points.map(([x, y]) => {
            const thumb = document.querySelector("#slider-label")!.parentElement!;
            const hit = document.elementFromPoint(x!, y!);
            return hit !== null && (hit === thumb || thumb.contains(hit));
          }),
        [
          [thumb!.left - 9, middle],
          [thumb!.right + 9, middle],
        ],
      );

      expect(hits).toEqual([true, true]);
    });
  });
}

for (const track of PHONE_TRACKS) {
  test.describe(`the bounds on a ${track}px track`, () => {
    test.use({ viewport: { width: track + 64, height: 400 }, contextOptions: { reducedMotion: "reduce" } });

    for (const market of [15, 85]) {
      test(`are both named beside a dropped chip at market ${market}`, async ({ page }) => {
        await open(page, { track, market });
        const shown = await geometry(page);

        expect(shown.placement).toBe("down");
        for (const side of ["lower", "upper"] as const) {
          expect.soft(shown[side].hidden, `${side} bound hidden`).toBe(false);
          expect.soft(overlaps(shown.chip, shown[side].box), `chip over the ${side} bound`).toBe(false);
        }
      });
    }
  });
}

/** The grid value nearest the market on `side` of it at which the pin still stands raised, if any. */
async function lastRaised(
  page: Page,
  query: { track: number; market: number; upper: number; unit: string },
  side: "below" | "above",
) {
  const step = 10 ** (Math.floor(Math.log10(query.upper)) - 2);
  const raisedAt = async (index: number) => {
    await open(page, { ...query, value: index * step });
    return (await geometry(page)).placement === "up";
  };
  const marketIndex = query.market / step;
  // `far` starts at the scale's end, `near` at the market, where the pin is dropped
  let [far, near] = side === "below" ? [0, marketIndex] : [query.upper / step, marketIndex];
  while (Math.abs(far - near) > 1) {
    const middle = Math.round((far + near) / 2);
    if (await raisedAt(middle)) far = middle;
    else near = middle;
  }
  return (await raisedAt(far)) ? far * step : undefined;
}

for (const track of [...PHONE_TRACKS, ...TRACKS]) {
  test.describe(`an open field beside a raised chip on a ${track}px track`, () => {
    test.use({ viewport: { width: track + 64, height: 400 }, contextOptions: { reducedMotion: "reduce" } });

    for (const [name, query, drafts] of [
      ["a millions scale", { market: 3250000, upper: 5000000, unit: "$M" }, ["4 999 999", "4999999.99"]],
      ["a percent scale", { market: 75, upper: 100, unit: "%" }, ["55.555", "100.00"]],
    ] as const) {
      for (const side of ["below", "above"] as const) {
        test(`never runs under the chip on ${name}, typed into ${side} the market`, async ({ page }) => {
          const value = await lastRaised(page, { track, ...query }, side);
          test.skip(value === undefined, `the pin drops for every value ${side} the market`);
          await page.getByRole("button", { name: "type your estimate for Movie A" }).click();
          for (const draft of drafts) {
            await page.getByRole("textbox").fill(draft);
            const shown = await geometry(page);
            expect.soft(shown.placement, `the pin with "${draft}" at ${value}`).toBe("up");
            expect.soft(overlaps(shown.chip, shown.pill), `"${draft}" under the chip at ${value}`).toBe(false);
          }
        });
      }
    }
  });
}

test.describe("the value pill", () => {
  test.use({ viewport: { width: 375, height: 400 } });

  const pill = (page: Page) => page.getByRole("button", { name: "type your estimate for Movie A" });
  const field = (page: Page) => page.getByRole("textbox", { name: "Your estimate for Movie A" });

  test("leaves the thumb where it is while a number is typed, and moves it on Enter", async ({ page }) => {
    await open(page, { track: 311, market: MARKET, value: 40 });
    const slider = page.getByRole("slider");

    await pill(page).click();
    await field(page).fill("90");
    await expect(slider).toHaveValue("40");
    await field(page).press("Enter");

    await expect(slider).toHaveValue("90");
    await expect(pill(page)).toBeFocused();
  });

  test("keeps a rounding note until focus moves on, then shows the hint again", async ({ page }) => {
    await open(page, { track: 311, market: MARKET, value: 40 });
    const status = page.getByRole("status");

    await pill(page).click();
    await field(page).fill("55.5");
    await field(page).press("Enter");
    await expect(status).toHaveText("Rounded to 56 %.");
    await page.waitForTimeout(300);
    await expect(status).toHaveText("Rounded to 56 %.");

    await page.keyboard.press("Shift+Tab");
    await expect(status).toHaveText("");
    await expect(page.getByText("19 % below the market")).toBeVisible();
  });

  for (const [typed, said] of [
    ["33.333", "Rounded to 33 %."],
    ["5000", "The most is 100 %."],
  ] as const) {
    test(`says "${said}" for ${typed} entered after a note that it was not a number`, async ({ page }) => {
      await open(page, { track: 311, market: MARKET, value: 40 });
      const status = page.getByRole("status");

      await pill(page).click();
      await field(page).fill("abc");
      await field(page).press("Enter");
      await expect(status).toHaveText("Enter a number.");
      await field(page).fill(typed);
      await field(page).press("Enter");

      await expect(status).toHaveText(said);
      await settle(page);
      await page.waitForTimeout(300);
      await expect(status).toHaveText(said);
    });
  }

  for (const [how, close] of [
    ["Tab", (page: Page) => page.keyboard.press("Tab")],
    ["Shift+Tab", (page: Page) => page.keyboard.press("Shift+Tab")],
    ["a press outside", (page: Page) => page.mouse.click(5, 380)],
  ] as const) {
    test(`keeps a rounding note applied as ${how} closes the field, until the next press`, async ({ page }) => {
      await open(page, { track: 311, market: MARKET, value: 40 });
      const status = page.getByRole("status");

      await pill(page).click();
      await field(page).fill("55.5");
      await close(page);
      await settle(page);
      await expect(status).toHaveText("Rounded to 56 %.");

      await page.mouse.click(5, 380);
      await expect(status).toHaveText("");
    });
  }

  /** Records every animation that starts from here on: its name, what it animates and for how long. */
  const recordMotion = (page: Page) =>
    page.evaluate(() => {
      const started: { name: string; properties: string[]; duration: number }[] = [];
      (window as unknown as { started: typeof started }).started = started;
      document.addEventListener("animationstart", (event) => {
        const animation = (event.target as Element)
          .getAnimations()
          .find((running) => (running as CSSAnimation).animationName === event.animationName)!;
        const properties = (animation.effect as KeyframeEffect)
          .getKeyframes()
          .flatMap((frame) => Object.keys(frame))
          .filter((key) => !["offset", "easing", "composite", "computedOffset"].includes(key));
        started.push({
          name: event.animationName,
          properties: [...new Set(properties)].sort(),
          duration: Number(animation.effect!.getComputedTiming().duration),
        });
      });
    });
  const motion = (page: Page) =>
    page.evaluate(() =>
      (window as unknown as { started: { name: string; properties: string[]; duration: number }[] }).started.splice(0),
    );

  test("settles into place by transform when a typed number is applied, and not when the field is cancelled", async ({
    page,
  }) => {
    await open(page, { track: 311, market: MARKET, value: 40 });
    await recordMotion(page);

    await pill(page).click();
    await field(page).fill("90");
    await field(page).press("Escape");
    await expect(pill(page)).toBeFocused();
    // an animation the cancel started would show by the second frame
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await motion(page), "after Escape").toEqual([]);
    await expect(pill(page)).not.toHaveClass(/fs-pill-commit/);

    await pill(page).click();
    await field(page).fill("90");
    await field(page).press("Enter");
    await expect(pill(page)).toBeFocused();
    await expect.poll(() => page.evaluate(() => (window as unknown as { started: unknown[] }).started.length)).toBe(1);
    expect(await motion(page), "after Enter").toEqual([
      { name: "fsPillCommit", properties: ["opacity", "transform"], duration: 250 },
    ]);
    await page.waitForFunction(() => document.getAnimations().length === 0);
    await page.evaluate(() => (window as unknown as { started: unknown[] }).started.splice(0));

    await pill(page).click();
    await field(page).fill("60");
    // a press outside the pill blurs the field, which applies what it holds
    await page.mouse.click(5, 5);
    await expect(pill(page)).toContainText("60");
    await expect.poll(() => page.evaluate(() => (window as unknown as { started: unknown[] }).started.length)).toBe(1);
    expect(await motion(page), "after a click away").toEqual([
      { name: "fsPillCommit", properties: ["opacity", "transform"], duration: 250 },
    ]);
  });

  test.describe("with reduced motion", () => {
    test.use({ contextOptions: { reducedMotion: "reduce" } });

    test("applies a typed number with no settling motion", async ({ page }) => {
      await open(page, { track: 311, market: MARKET, value: 40 });
      await recordMotion(page);

      await pill(page).click();
      await field(page).fill("90");
      await field(page).press("Enter");
      await expect(page.getByRole("slider")).toHaveValue("90");
      await settle(page);

      const started = await motion(page);
      expect(
        started.every(({ duration }) => duration <= 1),
        JSON.stringify(started),
      ).toBe(true);
    });
  });

  test("keeps the value on Escape", async ({ page }) => {
    await open(page, { track: 311, market: MARKET, value: 40 });

    await pill(page).click();
    await field(page).fill("90");
    await field(page).press("Escape");

    await expect(page.getByRole("slider")).toHaveValue("40");
    await expect(pill(page)).toBeFocused();
  });

  test("applies a typed number when the field loses focus", async ({ page }) => {
    await open(page, { track: 311, market: MARKET, value: 40 });

    await pill(page).click();
    await field(page).fill("62");
    await page.mouse.click(5, 380);

    await expect(page.getByRole("slider")).toHaveValue("62");
  });

  test("holds the unit beside the typed number", async ({ page }) => {
    await open(page, { track: 311, market: MARKET, value: 40 });

    await pill(page).click();
    const gap = await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('[data-testid="value-pill"] input')!;
      const unit = input.nextElementSibling!;
      const range = document.createRange();
      range.selectNodeContents(unit);
      // the input's text width, measured on a copy of its font
      const probe = document.createElement("span");
      probe.style.font = getComputedStyle(input).font;
      probe.style.fontVariantNumeric = "tabular-nums";
      probe.textContent = input.value;
      document.body.append(probe);
      const textRight = input.getBoundingClientRect().left + probe.getBoundingClientRect().width;
      probe.remove();
      return range.getBoundingClientRect().left - textRight;
    });

    expect(gap).toBeLessThanOrEqual(10);
  });

  test("shows the start of a long number in the field", async ({ page }) => {
    await open(page, { track: 256, market: 3250000, lower: 0, upper: 5000000, unit: "$M", value: 4000000 });

    await pill(page).click();
    await page.getByRole("textbox").fill("4999999.99");
    const input = page.getByRole("textbox");

    expect(await input.evaluate((field) => field.scrollWidth - field.clientWidth)).toBeLessThanOrEqual(1);
  });

  test("is reached by Tab from the slider and opened by Enter", async ({ page }) => {
    await open(page, { track: 311, market: MARKET, value: 40 });

    await page.getByRole("slider").focus();
    await page.keyboard.press("Tab");
    await expect(pill(page)).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(field(page)).toBeFocused();
  });
});

/** The WCAG contrast of an element's text on its own background, both resolved through a canvas to sRGB. */
function contrast(page: Page, selector: string) {
  return page.evaluate((selector) => {
    const element = document.querySelector(selector)!;
    const style = getComputedStyle(element);
    const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    const luminance = (css: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = css;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b] = Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3), (channel) => {
        const c = channel / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const [light, dark] = [luminance(style.color), luminance(style.backgroundColor)].sort((a, b) => b - a);
    return (light! + 0.05) / (dark! + 0.05);
  }, selector);
}

test.describe("the market chip's text", () => {
  test.use({ viewport: { width: 375, height: 400 } });

  for (const theme of ["light", "dark"]) {
    test(`reads at AA in the ${theme} theme`, async ({ page }) => {
      await open(page, { track: 311, market: MARKET, theme });

      expect(await contrast(page, '[data-testid="market-chip"]')).toBeGreaterThanOrEqual(4.5);
    });
  }
});

test.describe("the value pill's tint", () => {
  test.use({ viewport: { width: 375, height: 400 } });
  const PILL = '[data-testid="value-pill"] button';

  for (const theme of ["light", "dark"]) {
    test(`speaks in the hint's direction colour, at AA, above and below the market in the ${theme} theme`, async ({
      page,
    }) => {
      const backgrounds = new Set<string>();
      for (const value of [90, 40]) {
        await open(page, { track: 311, market: MARKET, value, theme });
        const hint = await page
          .getByRole("status")
          .locator("xpath=following-sibling::span")
          .evaluate((span) => getComputedStyle(span).color);

        await expect(page.locator(PILL)).toHaveCSS("color", hint);
        expect(await contrast(page, PILL), `at ${value}`).toBeGreaterThanOrEqual(4.5);
        backgrounds.add(await page.locator(PILL).evaluate((pill) => getComputedStyle(pill).backgroundColor));
      }
      expect(backgrounds.size, "a tint per direction").toBe(2);
    });

    test(`is neutral, at AA, at the market in the ${theme} theme`, async ({ page }) => {
      await open(page, { track: 311, market: MARKET, theme });
      const [text, chip] = await page.locator(PILL).evaluate((pill) => {
        const probe = document.createElement("span");
        probe.style.color = "var(--fs-popup-text)";
        probe.style.backgroundColor = "var(--fs-popup-chip)";
        pill.append(probe);
        const tones = [getComputedStyle(probe).color, getComputedStyle(probe).backgroundColor];
        probe.remove();
        return tones;
      });

      await expect(page.locator(PILL)).toHaveCSS("color", text!);
      await expect(page.locator(PILL)).toHaveCSS("background-color", chip!);
      expect(await contrast(page, PILL)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

test.describe("the fill's direction colour", () => {
  test.use({ viewport: { width: 375, height: 400 } });

  /** The coloured span's ends and the track's points for the market and the thumb, in page px. */
  const spanAgainst = (page: Page, value: number) =>
    page.evaluate(
      ([market, value]: [number, number]) => {
        const track = document.querySelector("#slider-track")!.getBoundingClientRect();
        const span = document.querySelector('[data-testid="estimate-span"]')!.getBoundingClientRect();
        const at = (share: number) => track.left + (share / 100) * track.width;
        return {
          span: [span.left, span.right],
          ends: [at(Math.min(market, value)), at(Math.max(market, value))],
          centre: [span.top + span.height / 2, track.top + track.height / 2],
        };
      },
      [MARKET, value] as [number, number],
    );

  // light: the darker tones that hold 3:1 on the card's surface; dark: futarchy's pastels
  for (const [theme, up, down] of [
    ["light", "rgb(22, 163, 74)", "rgb(224, 64, 95)"],
    ["dark", "rgb(210, 255, 220)", "rgb(255, 210, 219)"],
  ] as const) {
    test(`paints only the gap to the market, ${up} above and ${down} below, in the ${theme} theme`, async ({
      page,
    }) => {
      for (const [value, colour] of [
        [90, up],
        [40, down],
      ] as const) {
        await open(page, { track: 311, market: MARKET, value, theme });
        await expect(page.getByTestId("estimate-span")).toHaveCSS("background-color", colour);
        await expect(page.locator("#slider-fill")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
        await expect(page.locator("#slider-fill")).toHaveCSS("background-image", "none");

        const { span, ends, centre } = await spanAgainst(page, value);
        expect(span[0], `the span's start at ${value}`).toBeCloseTo(ends[0]!, 0);
        expect(span[1], `the span's end at ${value}`).toBeCloseTo(ends[1]!, 0);
        expect(centre[0], "the span sits on the track").toBeCloseTo(centre[1]!, 0);
      }
    });
  }

  test("is the brand gradient at the market, with no span", async ({ page }) => {
    await open(page, { track: 311, market: MARKET });

    await expect(page.locator("#slider-fill")).toHaveCSS("background-image", /^linear-gradient/);
    await expect(page.getByTestId("estimate-span")).toHaveCount(0);
  });

  test("dims a locked slider in the popup's track tones, not the library's blue", async ({ page }) => {
    await open(page, { track: 311, market: MARKET, value: 90, locked: 1 });
    const tone = (css: string) =>
      page.evaluate((css) => {
        const probe = document.createElement("span");
        probe.style.backgroundColor = css;
        document.body.append(probe);
        const resolved = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return resolved;
      }, css);

    await expect(page.locator("#slider-track")).toHaveCSS("background-color", await tone("var(--fs-popup-track)"));
    await expect(page.locator("#slider-fill")).toHaveCSS("background-color", await tone("var(--fs-popup-track-dot)"));
  });
});

/** Drives the transitions running on the market pin and inside it; returns what each animates. */
function pinAnimations(page: Page, action: "pause" | "finish" | "cancel" | "seek", at = 0) {
  return page.evaluate(
    ([action, at]) =>
      document
        .querySelector('[data-testid="market-pin"]')!
        .getAnimations({ subtree: true })
        .map((animation) => {
          if (action === "seek") animation.currentTime = at as number;
          else animation[action as "pause" | "finish" | "cancel"]();
          return (animation as CSSTransition).transitionProperty;
        }),
    [action, at] as const,
  );
}

const chipTop = (page: Page) => page.getByTestId("market-chip").evaluate((chip) => chip.getBoundingClientRect().top);

/** Steps the thumb right until the pin drops, leaving its transitions paused at their start. */
async function stepUntilDropped(page: Page) {
  const slider = page.getByRole("slider");
  const pin = page.getByTestId("market-pin");
  await slider.focus();
  let before = await chipTop(page);
  for (let step = 0; step < 100 && (await pin.getAttribute("data-placement")) === "up"; step++) {
    await pinAnimations(page, "finish");
    before = await chipTop(page);
    await slider.press("ArrowRight");
  }
  await expect(pin).toHaveAttribute("data-placement", "down");
  await pinAnimations(page, "pause");
  return before;
}

test.describe("the market pin's drop", () => {
  test.use({ viewport: { width: 375, height: 400 } });

  test("moves the chip from where it stood, by transform, over the structural duration", async ({ page }) => {
    await open(page, { track: 311, market: MARKET, value: 20 });
    const before = await stepUntilDropped(page);

    const moves = await pinAnimations(page, "pause");
    expect(moves.every((property) => ["transform", "opacity"].includes(property))).toBe(true);
    const timing = await page.evaluate(() =>
      document
        .querySelector('[data-testid="market-pin"]')!
        .getAnimations()
        .map((animation) => animation.effect!.getComputedTiming()),
    );
    expect(timing[0]!.duration).toBe(400);

    await pinAnimations(page, "seek", 0);
    expect(Math.abs((await chipTop(page)) - before), "the chip's first frame is where it stood").toBeLessThanOrEqual(1);
  });

  test("settles with a spring, passing its resting place before it comes back", async ({ page }) => {
    await open(page, { track: 311, market: MARKET, value: 20 });
    await stepUntilDropped(page);
    await pinAnimations(page, "finish");
    const rest = await chipTop(page);
    await pinAnimations(page, "cancel");

    // replay the drop from the raised pin
    await page.getByRole("slider").press("Home");
    await pinAnimations(page, "finish");
    await stepUntilDropped(page);

    let lowest = -Infinity;
    for (let ms = 0; ms <= 400; ms += 20) {
      await pinAnimations(page, "seek", ms);
      lowest = Math.max(lowest, await chipTop(page));
    }
    expect(lowest - rest, "the overshoot past its resting place").toBeGreaterThanOrEqual(1);
  });

  test.describe("with reduced motion", () => {
    test.use({ contextOptions: { reducedMotion: "reduce" } });

    test("lands at once, with no spring, sliding clear of a bound included", async ({ page }) => {
      // at 85 the dropped chip slides off the upper bound
      await open(page, { track: 311, market: 85, value: 20 });
      await stepUntilDropped(page);

      const timing = await page.evaluate(() =>
        document
          .querySelector('[data-testid="market-pin"]')!
          .getAnimations({ subtree: true })
          .map((animation) => ({
            duration: Number(animation.effect!.getComputedTiming().duration),
            easing: animation.effect!.getComputedTiming().easing,
          })),
      );
      expect(timing.every(({ duration }) => duration <= 1)).toBe(true);
    });
  });
});

test.describe("a value whose label changes width", () => {
  for (const track of TRACKS) {
    test.describe(`on a ${track}px track`, () => {
      test.use({ viewport: { width: track + 64, height: 400 } });

      for (const [name, query, act] of [
        [
          "End from 87 on 0 to 100",
          { track, market: MARKET, value: 87 },
          async (page: Page) => {
            await page.getByRole("slider").focus();
            await page.keyboard.press("End");
          },
        ],
        [
          "a typed 0 from 87 on 0 to 100",
          { track, market: MARKET, value: 87 },
          async (page: Page) => {
            await page.getByRole("button", { name: "type your estimate for Movie A" }).click();
            await page.getByRole("textbox", { name: "Your estimate for Movie A" }).fill("0");
            await page.keyboard.press("Enter");
          },
        ],
      ] as const) {
        test(`keeps the card mounted after ${name}, three runs`, async ({ page }) => {
          const errors: string[] = [];
          page.on("pageerror", (error) => errors.push(error.message));
          for (let run = 0; run < 3; run++) {
            await open(page, query);
            await act(page);
            await settle(page);
            await expect(page.getByTestId("value-pill"), `run ${run + 1}`).toBeVisible();
            expect(errors, `run ${run + 1}`).toEqual([]);
          }
        });
      }
    });
  }
});
