// Regenerates the app icons in src/app/ from src/assets/logo/foresight-mark.svg.
// Run from apps/web: `node scripts/generate-icons.mjs`. Needs Playwright's chromium.
import { Buffer } from "node:buffer";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

const webRoot = path.resolve(import.meta.dirname, "..");
const markPath = path.join(webRoot, "src/assets/logo/foresight-mark.svg");
const appDir = path.join(webRoot, "src/app");

const FAVICON_SIZES = [16, 32, 48];
const ICON1_SIZE = 96;
const APPLE_ICON_SIZE = 180;

/**
 * iOS fills a transparent touch icon with black, so the apple icon gets an opaque
 * background and the 20px inset Apple's template leaves around the artwork.
 */
async function render(page, svg, size, { background = "transparent", inset = 0 } = {}) {
  await page.setViewportSize({ width: size, height: size });
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  await page.setContent(
    `<html><body style="margin:0;background:${background}">` +
      `<img src="${src}" style="display:block;box-sizing:border-box;width:${size}px;height:${size}px;padding:${inset}px">` +
      `</body></html>`,
  );
  await page.locator("img").evaluate((img) => img.decode());
  return page.screenshot({ omitBackground: background === "transparent" });
}

/** An ICO whose entries are PNGs, which every browser and Windows Vista onward read. */
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);

  let offset = 6 + pngs.length * 16;
  const entries = pngs.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry[0] = size;
    entry[1] = size;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...pngs.map(({ png }) => png)]);
}

const svg = await readFile(markPath, "utf8");
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });

  const favicons = [];
  for (const size of FAVICON_SIZES) favicons.push({ size, png: await render(page, svg, size) });
  await writeFile(path.join(appDir, "favicon.ico"), ico(favicons));

  await writeFile(path.join(appDir, "icon1.png"), await render(page, svg, ICON1_SIZE));
  await writeFile(
    path.join(appDir, "apple-icon.png"),
    await render(page, svg, APPLE_ICON_SIZE, { background: "#ffffff", inset: 20 }),
  );
  await copyFile(markPath, path.join(appDir, "icon0.svg"));
} finally {
  await browser.close();
}
