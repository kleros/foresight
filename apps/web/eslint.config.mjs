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
    // A flow adapter is a pure function of snapshot and context: the
    // orchestrator rebuilds every step from scratch on each attempt, including
    // after a reload, so anything that reaches for a hook, a router or a live
    // wallet client breaks resume in a way tests do not catch. This used to be
    // enforced by the folder being its own package, with its own dependencies.
    files: ["src/features/*/flow/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "react",
                "react-dom",
                "next",
                "next/*",
                "wagmi",
                "wagmi/*",
                "@wagmi/*",
                "@reown/*",
                "@tanstack/*",
              ],
              message:
                "Flow adapters must stay framework-free: they are rebuilt from persisted state on resume. Take what you need as an argument instead.",
            },
          ],
        },
      ],
    },
  },
  {
    // Every internal href goes through `src/config/paths.ts`.
    files: ["src/**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: 'JSXAttribute[name.name="href"] > Literal[value=/^\\//]',
          message: "Link through paths.getHref() from @/config/paths instead of writing the route.",
        },
        {
          selector: 'JSXAttribute[name.name="href"] TemplateLiteral[quasis.0.value.raw=/^\\//]',
          message: "Link through paths.getHref() from @/config/paths instead of writing the route.",
        },
      ],
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
