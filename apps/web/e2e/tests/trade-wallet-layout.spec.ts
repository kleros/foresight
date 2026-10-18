import { expect, test, type Page } from "@playwright/test";

import { openHarness, startHarness } from "../utils/component-harness";

const LONGEST = "Greater Metropolitan Region of São Paulo and Surrounding Areas";
const PHONES = [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
];

let harness: Awaited<ReturnType<typeof startHarness>>;

test.beforeAll(async () => {
  harness = await startHarness("trade-wallet");
});

test.afterAll(async () => {
  await harness?.close();
});

async function open(page: Page, query: Record<string, string>) {
  await openHarness(page, `${harness.url}?${new URLSearchParams(query)}`);
}

for (const viewport of PHONES) {
  test(`option names truncate inside their cards and the page does not scroll sideways at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await open(page, { view: "balances" });
    const name = page.getByText(LONGEST, { exact: true });
    await expect(name).toBeVisible();

    const layout = await page.evaluate(() => ({
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      wallet: document.querySelector("section")!.getBoundingClientRect().right,
    }));
    const spans = await name.evaluate((element) => ({
      clipped: element.scrollWidth > element.clientWidth,
      right: element.getBoundingClientRect().right,
    }));

    expect(layout.pageOverflow).toBe(0);
    expect(spans.clipped).toBe(true);
    expect(spans.right).toBeLessThanOrEqual(layout.wallet);
  });

  test(`an over-balance line in Mint reads left-aligned and keeps the dialog's height at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await open(page, { view: "mint", available: "98765432109.1234" });
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/^Balance: /)).toBeVisible();
    const before = (await dialog.boundingBox())!.height;

    await dialog.getByRole("spinbutton").fill("999999999999");
    const message = dialog.getByText(/^Not enough balance\. Max /);
    await expect(message).toBeVisible();

    expect(await message.evaluate((element) => getComputedStyle(element).textAlign)).toBe("left");
    expect((await message.boundingBox())!.height).toBeGreaterThan(30);
    expect((await dialog.boundingBox())!.height).toBe(before);
  });
}

test("the dialog's close button stays in view once its content is scrolled to the end", async ({ page }) => {
  // shorter than the Mint dialog once the dialog keeps 4.5rem clear above and below
  await page.setViewportSize({ width: 375, height: 400 });
  await open(page, { view: "mint" });
  const close = page.getByRole("button", { name: "Close" });
  await expect(close).toBeVisible();

  const scrolled = await page.getByRole("dialog").evaluate((dialog) => {
    const scrollers = [dialog, ...dialog.querySelectorAll("*")].filter(
      (element) => element.scrollHeight > element.clientHeight + 1 && getComputedStyle(element).overflowY === "auto",
    );
    for (const scroller of scrollers) scroller.scrollTop = scroller.scrollHeight;
    return scrollers.length;
  });
  expect(scrolled).toBe(1);

  const shown = await close.evaluate((element) => {
    const { left, top, width, height } = element.getBoundingClientRect();
    const hit = document.elementFromPoint(left + width / 2, top + height / 2);
    return top >= 0 && hit !== null && element.contains(hit);
  });
  expect(shown).toBe(true);
});

test("a light button eases named properties, never every one", async ({ page }) => {
  await open(page, { view: "mint" });
  const max = page.getByRole("button", { name: "Max" });
  await expect(max).toBeVisible();

  const properties = await max.evaluate((element) => getComputedStyle(element).transitionProperty);

  expect(properties.split(", ")).not.toContain("all");
  expect(properties).toContain("background-color");
});

for (const { width, inset } of [
  { width: 1280, inset: "32px" },
  { width: 375, inset: "16px" },
]) {
  test(`the trade wallet wears the Predict card's radius, hairline and ${inset} inset at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await open(page, { view: "balances" });
    const wallet = page.getByRole("region", { name: "Trade wallet" });

    await expect(wallet).toHaveCSS("border-top-left-radius", "12px");
    await expect(wallet).toHaveCSS("padding-left", inset);
    await expect(wallet).toHaveCSS("padding-top", "16px");
    const hairline = await wallet.evaluate((element) => getComputedStyle(element, "::before").backgroundImage);
    expect(hairline).toContain("linear-gradient");
  });
}
