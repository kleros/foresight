import { architectureConfig } from "@foresight/eslint-config/architecture";
import { nextJsConfig } from "@foresight/eslint-config/next-js";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...nextJsConfig,
  architectureConfig(import.meta.dirname),
  {
    settings: {
      next: {
        rootDir: ".",
      },
    },
  },
  {
    // Playwright fixtures take a `use` callback, which the React plugin reads as
    // React's `use` hook and rejects for being called outside a component.
    files: ["e2e/**/*.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
];
