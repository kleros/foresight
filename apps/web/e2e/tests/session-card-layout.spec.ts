import { expect, test } from "@playwright/test";

import { openHarness, startHarness } from "../utils/component-harness";

let harness: Awaited<ReturnType<typeof startHarness>>;

test.beforeAll(async () => {
  harness = await startHarness("session-card");
});

test.afterAll(async () => {
  await harness?.close();
});

const CASES = {
  "two winners": "winners=Scaling%20with%20blobs|Account%20abstraction%20today",
  "three winners": "winners=Scaling%20with%20blobs|Account%20abstraction%20today|Privacy%20pools",
};

for (const width of [375, 1280]) {
  test.describe(`a resolved session card at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    for (const [name, query] of Object.entries(CASES)) {
      test(`shows all ${name} at rest, none cut off`, async ({ page }) => {
        await openHarness(page, `${harness.url}?${query}`);
        const names = page.locator("p").filter({ hasText: /^Selected:/ });

        const fit = await names.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const lineHeight = parseFloat(getComputedStyle(element).lineHeight);
          // the card body clips its overflow, and clipped content takes no hit
          const found = document.elementFromPoint(box.left + 4, box.bottom - lineHeight / 2);
          return {
            wide: element.scrollWidth <= element.clientWidth,
            tall: element.scrollHeight <= element.clientHeight,
            lastLineShown: found !== null && element.contains(found),
          };
        });
        expect(fit).toEqual({ wide: true, tall: true, lastLineShown: true });
      });
    }
  });
}
