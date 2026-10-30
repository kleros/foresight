import { execFile } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { expect, test } from "@playwright/test";

import { decodePng, pngSize } from "../../src/test/png";

const WEB_ROOT = path.resolve(__dirname, "../..");
const APP_DIR = path.join(WEB_ROOT, "src/app");
const PUBLIC_DIR = path.join(WEB_ROOT, "public");

/** Next's file-based icon names: favicon.ico, icon*.*, apple-icon*.*. */
const ICON_FILE = /^(favicon\.ico|icon\d*\.\w+|apple-icon\d*\.\w+)$/;

/** Channel difference above which two pixels count as different; absorbs font anti-aliasing. */
const PIXEL_TOLERANCE = 32;

function differingPixelShare(a: Uint8Array, b: Uint8Array) {
  const left = decodePng(a);
  const right = decodePng(b);
  expect({ width: left.width, height: left.height }).toEqual({ width: right.width, height: right.height });

  let differing = 0;
  for (let at = 0; at < left.rgba.length; at += 4) {
    if ([0, 1, 2].some((c) => Math.abs((left.rgba[at + c] ?? 0) - (right.rgba[at + c] ?? 0)) > PIXEL_TOLERANCE))
      differing++;
  }
  return differing / (left.width * left.height);
}

test("the homepage links every app icon, each served as the committed file", async ({ page, request }) => {
  await page.goto("/");
  const hrefs = await page
    .locator('link[rel="icon"], link[rel="apple-touch-icon"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));

  const linked = hrefs.map((href) => new URL(href, page.url()).pathname.slice(1));
  expect([...linked].sort()).toEqual(
    readdirSync(APP_DIR)
      .filter((name) => ICON_FILE.test(name))
      .sort(),
  );

  for (const href of hrefs) {
    const response = await request.get(href);
    expect(response.status(), href).toBe(200);
    expect(
      Buffer.compare(await response.body(), readFileSync(path.join(APP_DIR, new URL(href, page.url()).pathname))),
      href,
    ).toBe(0);
  }
});

test("og:image and twitter:image serve the committed share image", async ({ page, request }) => {
  await page.goto("/");

  for (const selector of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) {
    const content = (await page.locator(selector).getAttribute("content")) ?? "";
    // The content is absolute against metadataBase, which may name the production host.
    const { pathname } = new URL(content);
    const response = await request.get(pathname);

    expect(response.status(), selector).toBe(200);
    expect(Buffer.compare(await response.body(), readFileSync(path.join(PUBLIC_DIR, pathname))), selector).toBe(0);
  }
});

test("the capture script regenerates the committed share image from the running homepage", async ({ baseURL }) => {
  test.setTimeout(120_000);
  const outDir = mkdtempSync(path.join(tmpdir(), "foresight-og-"));
  const capture = async (name: string) => {
    const out = path.join(outDir, name);
    await promisify(execFile)("node", ["scripts/capture-og-image.mjs", baseURL!, out], { cwd: WEB_ROOT });
    return readFileSync(out);
  };

  const first = await capture("first.png");
  const second = await capture("second.png");

  const committed = readFileSync(path.join(PUBLIC_DIR, "foresight-og.png"));
  expect(pngSize(second)).toEqual(pngSize(first));
  expect(pngSize(first)).toEqual(pngSize(committed));
  expect(differingPixelShare(first, committed)).toBeLessThan(0.01);
});
