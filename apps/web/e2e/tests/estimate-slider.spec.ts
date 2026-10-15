import { expect, test, type Page } from "@playwright/test";

import { startHarness } from "../utils/component-harness";

/** The slider's track in an option card: 375 and 1280 wide windows. */
const TRACKS = [311, 1112];
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
  await page.goto(`${harness.url}?${search}`);
  await expect(page.getByTestId("market-chip")).toBeVisible();
}

/** Where everything the pin can collide with is drawn, in page px. */
async function geometry(page: Page) {
  // the pin is placed from a measurement taken after the thumb's render, and the thumb glides
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForFunction(() => document.getAnimations().length === 0);
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
      chip: box(pin.querySelector('[data-testid="market-chip"]')),
      stick: box(pin.querySelector('[data-testid="market-stick"]')),
      label: (() => {
        const label = document.querySelector("#slider-label")!;
        return getComputedStyle(label).visibility === "hidden" ? null : box(label);
      })(),
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
    // the pin's drop is a transition; geometry is read where it lands
    test.use({ viewport: { width: track + 64, height: 400 }, contextOptions: { reducedMotion: "reduce" } });

    test("stands up with no estimate set, in place of the thumb's number, and prints both bounds", async ({ page }) => {
      await open(page, { track, market: MARKET });
      const shown = await geometry(page);

      expect(shown.placement).toBe("up");
      expect(shown.label, "the thumb's number").toBeNull();
      expect(shown.lower.hidden).toBe(false);
      expect(shown.upper.hidden).toBe(false);
    });

    test("drops only within futarchy's 5 % of the market", async ({ page }) => {
      for (const [gap, placement] of [
        [0, "down"],
        [3, "down"],
        [-5, "down"],
        [8, "up"],
        [12, "up"],
        [16, "up"],
        [-20, "up"],
      ] as const) {
        await open(page, { track, market: MARKET, value: MARKET + gap });
        expect.soft((await geometry(page)).placement, `${gap} from the market`).toBe(placement);
      }
    });

    test("never draws the chip over the thumb's number, and drops the stick before it crosses it", async ({ page }) => {
      await open(page, { track, market: MARKET, value: 0 });
      const slider = page.getByRole("slider");
      await slider.focus();
      for (let value = 0; value <= 100; value++) {
        if (value > 0) await slider.press("ArrowRight");
        const shown = await geometry(page);
        expect.soft(overlaps(shown.chip, shown.label), `chip over the label at ${value}`).toBe(false);
        expect.soft(overlaps(shown.chip, shown.thumb), `chip over the thumb at ${value}`).toBe(false);
        if (shown.placement === "up") {
          expect.soft(overlaps(shown.stick, shown.label), `stick through the label at ${value}`).toBe(false);
        }
        for (const side of ["lower", "upper"] as const) {
          const bound = shown[side];
          // a bound steps aside only for a dropped chip that sits on it
          expect
            .soft(bound.hidden, `${side} bound at ${value}`)
            .toBe(shown.placement === "down" && overlaps(shown.chip, bound.box));
        }
      }
    });

    for (const market of [0, 2, 98, 100]) {
      test(`keeps the chip on the track with the market at ${market}`, async ({ page }) => {
        for (const value of [undefined, market]) {
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

test.describe("the market chip's text", () => {
  test.use({ viewport: { width: 375, height: 400 } });

  for (const [color, text] of [
    ["#009aff", "rgb(0, 0, 0)"],
    ["#7e1bd4", "rgb(255, 255, 255)"],
  ] as const) {
    test(`reads at AA on ${color}`, async ({ page }) => {
      await open(page, { track: 311, market: MARKET, color });

      await expect(page.getByTestId("market-chip")).toHaveCSS("color", text);
    });
  }
});

test.describe("the fill's direction colour", () => {
  test.use({ viewport: { width: 375, height: 400 } });

  // light: the darker tones that hold 3:1 on the sunken surface; dark: futarchy's pastels
  for (const [theme, up, down] of [
    ["light", "rgb(22, 163, 74)", "rgb(224, 64, 95)"],
    ["dark", "rgb(210, 255, 220)", "rgb(255, 210, 219)"],
  ] as const) {
    test(`is ${up} above and ${down} below the market in the ${theme} theme`, async ({ page }) => {
      for (const [value, colour] of [
        [90, up],
        [40, down],
      ] as const) {
        await open(page, { track: 311, market: MARKET, value, theme });
        await expect(page.locator("#slider-fill")).toHaveCSS("background-color", colour);
      }
    });
  }
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

test.describe("the market pin's drop", () => {
  test.use({ viewport: { width: 375, height: 400 } });

  test("moves the chip from where it stood, by transform, and eases out of the start", async ({ page }) => {
    await open(page, { track: 311, market: MARKET, value: 50 });
    const slider = page.getByRole("slider");
    const pin = page.getByTestId("market-pin");
    const chipTop = () => page.getByTestId("market-chip").evaluate((chip) => chip.getBoundingClientRect().top);
    await slider.focus();

    let before = await chipTop();
    for (let value = 51; value <= MARKET && (await pin.getAttribute("data-placement")) === "up"; value++) {
      before = await chipTop();
      await slider.press("ArrowRight");
    }
    expect(await pin.getAttribute("data-placement")).toBe("down");

    const moves = await pinAnimations(page, "pause");
    expect(moves.every((property) => ["translate", "transform", "opacity"].includes(property))).toBe(true);
    const seek = (ms: number) => pinAnimations(page, "seek", ms);

    await seek(0);
    expect(Math.abs((await chipTop()) - before), "the chip's first frame is where it stood").toBeLessThanOrEqual(1);
    await pinAnimations(page, "finish");
    const after = await chipTop();
    await pinAnimations(page, "cancel");

    // replay the drop and read it a tenth of the way through
    for (let step = 0; step < 10 && (await pin.getAttribute("data-placement")) === "down"; step++) {
      await slider.press("ArrowLeft");
      await pinAnimations(page, "finish");
    }
    await expect(pin).toHaveAttribute("data-placement", "up");
    for (let step = 0; step < 10 && (await pin.getAttribute("data-placement")) === "up"; step++) {
      await slider.press("ArrowRight");
    }
    await expect(pin).toHaveAttribute("data-placement", "down");
    await pinAnimations(page, "pause");
    const duration = await page.evaluate(() =>
      Math.max(
        ...document
          .querySelector('[data-testid="market-pin"]')!
          .getAnimations({ subtree: true })
          .map((animation) => Number(animation.effect!.getTiming().duration)),
      ),
    );
    expect(duration).toBeGreaterThanOrEqual(250);
    await seek(duration / 10);
    expect((await chipTop()) - before, "a tenth of the way in").toBeLessThan((after - before) / 5);
  });
});
