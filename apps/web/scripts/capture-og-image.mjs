// Screenshots the running app's homepage into public/foresight-og.png, the default share image.
// Run from apps/web against a running app: `node scripts/capture-og-image.mjs [baseUrl]`
// (default http://localhost:3000). Needs Playwright's chromium.
import path from "node:path";
import process from "node:process";

import { chromium } from "playwright";

const baseUrl = process.argv[2] ?? "http://localhost:3000";
const out = path.resolve(import.meta.dirname, "../public/foresight-og.png");

const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
    colorScheme: "light",
  });
  const page = await context.newPage();
  await page.goto(new URL("/", baseUrl).href, { waitUntil: "networkidle" });
  // `nextjs-portal` is the dev server's build indicator.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: out });
  console.log(`wrote ${path.relative(process.cwd(), out)}`);
} finally {
  await browser.close();
}
