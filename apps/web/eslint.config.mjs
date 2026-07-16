import { nextJsConfig } from "@foresight/eslint-config/next-js";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...nextJsConfig,
  {
    settings: {
      next: {
        rootDir: ".",
      },
    },
  },
];
