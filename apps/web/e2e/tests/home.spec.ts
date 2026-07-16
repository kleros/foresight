import { expect, test } from "@playwright/test";

test("homepage shows Foresight", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Foresight" })).toBeVisible();
});
