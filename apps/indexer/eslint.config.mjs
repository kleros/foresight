import { libraryConfig } from "@foresight/eslint-config/library";

/** @type {import("eslint").Linter.Config[]} */
export default [
  {
    ignores: [".envio/**", "envio-env.d.ts"],
  },
  ...libraryConfig,
  {
    // Types are exempt because envio loads handlers through tsx, which erases them.
    files: ["src/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@foresight/*"],
              allowTypeImports: true,
              message:
                "Envio Cloud installs apps/indexer alone; only `import type` may cross into a workspace package.",
            },
          ],
        },
      ],
    },
  },
];
