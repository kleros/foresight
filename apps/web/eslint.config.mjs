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
];
