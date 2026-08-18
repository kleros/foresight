import { expect, test } from "@playwright/test";

test("homepage shows the session list", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible();
});

test("homepage offers no wallet UI", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Connect" })).toHaveCount(0);
});

test("create route shows the connect button in the navbar", async ({ page }) => {
  await page.goto("/create");
  await expect(page.getByRole("banner").getByRole("button", { name: "Connect" })).toBeVisible();
});
