import path from "node:path";

import svgr from "vite-plugin-svgr";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // next.config.mjs runs svg imports through @svgr/webpack, so without the same
  // treatment here a component that renders an icon fails on the import rather
  // than on anything it does. This plugin defaults to `?react` imports only,
  // hence the wider `include` to match what webpack converts.
  //
  // Held at v4 deliberately: v5 calls vite's `transformWithOxc`, which this
  // repo's vite does not have.
  plugins: [svgr({ include: "**/*.svg", exclude: "**/*.svg?url" })],
  // Next's tsconfig keeps `jsx: preserve`; vite 8's oxc transform must be told
  // to compile JSX for tests, or .tsx files pass through unparsed.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
    // `@kleros/kleros-app` publishes `module` with no `main` or `exports`, so
    // Node-style resolution finds nothing. Bundlers read `module` already;
    // this tells the test runner to as well.
    mainFields: ["module", "browser", "main"],
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // The Kleros library imports its own stylesheet; Vite must process that
    // import rather than handing the .css to Node's loader.
    server: { deps: { inline: [/@kleros\/ui-components-library/] } },
  },
});
