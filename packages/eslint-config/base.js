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
  {
    rules: {
      // a `_` prefix and a rest-destructuring sibling are both deliberate omissions,
      // not dead code - `const { icon, ...rest }` is how a key gets dropped
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
];
