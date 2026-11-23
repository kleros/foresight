import { expect, test, type Page } from "@playwright/test";

import { openHarness, startHarness } from "../utils/component-harness";

let harness: Awaited<ReturnType<typeof startHarness>>;

test.beforeAll(async () => {
  harness = await startHarness("session-card");
});

test.afterAll(async () => {
  await harness?.close();
});

/** Winning names a resolved card has to show in full at rest. */
const CASES = {
  "two long names": ["Scaling Ethereum with blobs after Pectra", "Account abstraction today: what ships next"],
  "three names": ["Scaling with blobs", "Account abstraction today", "Privacy pools in production"],
  "four names": [
    "Scaling Ethereum with blobs after Pectra",
    "Account abstraction today: what ships next",
    "Privacy pools in production",
    "MEV in 2027",
  ],
  "a long title above two names": ["Scaling Ethereum with blobs after Pectra", "Account abstraction today"],
};

async function winnerLine(page: Page, names: string[], title?: string) {
  const query = new URLSearchParams({ winners: names.join("|"), ...(title ? { title } : {}) });
  await openHarness(page, `${harness.url}?${query}`);
  return page.getByTitle(names.join(", ")).first();
}

for (const width of [375, 1280]) {
  test.describe(`a resolved session card at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    for (const [name, names] of Object.entries(CASES)) {
      test(`shows ${name} whole, inside the card's body`, async ({ page }) => {
        const title = name.startsWith("a long title")
          ? "Devcon 8 in Mumbai: which of the community talks fill the main stage on day two"
          : undefined;
        const line = await winnerLine(page, names, title);
        await expect(line).toBeVisible();

        const fit = await line.evaluate((element) => {
          const column = element.closest(".overflow-hidden") as HTMLElement;
          const footer = column.nextElementSibling as HTMLElement;
          return {
            clamped: element.scrollHeight - element.clientHeight,
            below: element.getBoundingClientRect().bottom - column.getBoundingClientRect().bottom,
            overFooter: element.getBoundingClientRect().bottom - footer.getBoundingClientRect().top,
          };
        });
        expect(fit.clamped, "no line cut by the clamp").toBeLessThanOrEqual(1);
        expect(fit.below, "the last line above the body's overflow edge").toBeLessThanOrEqual(0);
        expect(fit.overFooter, "the last line above the icon row").toBeLessThanOrEqual(0);
        for (const winner of names) await expect(line).toContainText(winner);
      });
    }
  });
}
