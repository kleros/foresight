import path from "node:path";

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
