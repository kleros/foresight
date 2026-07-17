import { importX } from "eslint-plugin-import-x";

/**
 * Import groups for React apps (`@/` = internal).
 * Used by next-js and react-internal (Vite) configs.
 *
 * @type {import("eslint").Linter.Config}
 */
export const importOrderConfig = {
  plugins: {
    "import-x": importX,
  },
  rules: {
    "import-x/order": [
      "error",
      {
        groups: ["builtin", "external", "internal", ["parent", "sibling", "index"]],
        pathGroups: [
          {
            pattern: "{react,react-dom,react-dom/**,next,next/**}",
            group: "external",
            position: "before",
          },
          { pattern: "@/features{,/**}", group: "internal", position: "before" },
          { pattern: "@/components{,/**}", group: "internal", position: "before" },
          { pattern: "@/assets{,/**}", group: "internal", position: "before" },
          { pattern: "@/utils{,/**}", group: "internal", position: "before" },
          { pattern: "@/lib{,/**}", group: "internal", position: "before" },
          { pattern: "@/config{,/**}", group: "internal", position: "before" },
          { pattern: "@/styles{,/**}", group: "internal", position: "before" },
          { pattern: "@/**", group: "internal", position: "before" },
        ],
        pathGroupsExcludedImportTypes: ["builtin"],
        distinctGroup: true,
        "newlines-between": "always",
        alphabetize: { order: "asc", caseInsensitive: true },
      },
    ],
  },
};
