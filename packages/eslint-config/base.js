import js from "@eslint/js";
import turboPlugin from "eslint-plugin-turbo";
import tseslint from "typescript-eslint";

/**
 * Shared ESLint flat config for the monorepo.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export const config = [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/out/**",
      "**/build/**",
      "**/generated/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/artifacts/**",
      "**/cache/**",
      "packages/contracts/out/**",
      "packages/contracts/lib/**",
      "apps/subgraph/**/build/**",
      "apps/subgraph/**/generated/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      turbo: turboPlugin,
    },
    rules: {
      "turbo/no-undeclared-env-vars": "error",
    },
  },
];
