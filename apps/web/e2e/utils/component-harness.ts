import path from "node:path";

import { expect, type Page } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import svgr from "vite-plugin-svgr";

const WEB_ROOT = path.resolve(__dirname, "../..");

/**
 * Serves `e2e/harness/<name>/index.html` with the app's own CSS, aliases and svg
 * handling, so a component renders in a real browser without the chain or indexer.
 */
export async function startHarness(name: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server: ViteDevServer = await createServer({
    configFile: false,
    root: path.join(WEB_ROOT, "e2e/harness", name),
    logLevel: "error",
    plugins: [svgr({ include: "**/*.svg", exclude: "**/*.svg?url" })],
    esbuild: { jsx: "automatic" },
    resolve: {
      alias: { "@": path.join(WEB_ROOT, "src") },
      mainFields: ["module", "browser", "main"],
    },
    // postcss.config.mjs, which runs Tailwind over src/
    css: { postcss: WEB_ROOT },
    server: { port: 0 },
  });
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error(`The ${name} harness did not report a URL.`);
  return { url, close: () => server.close() };
}

/** Opens a harness page once its Inter faces have loaded, so a layout is measured in the shipped font. */
export async function openHarness(page: Page, url: string): Promise<void> {
  await page.goto(url);
  // Vite reloads a page whose first request makes it optimise a dependency, which drops this evaluation
  await expect
    .poll(
      () =>
        page
          .evaluate(() =>
            Promise.all(["400", "500", "600", "700"].map((weight) => document.fonts.load(`${weight} 16px Inter`))),
          )
          .then((faces) => faces.map((found) => found.length))
          .catch(() => []),
      { message: "each Inter weight loads from e2e/harness/inter.css" },
    )
    .toEqual([1, 1, 1, 1]);
}
