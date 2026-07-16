import { importX } from "eslint-plugin-import-x";

/**
 * Simple import groups for React apps (`@/` = internal).
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
          { pattern: "react", group: "external", position: "before" },
          { pattern: "react-dom", group: "external", position: "before" },
          { pattern: "next", group: "external", position: "before" },
          { pattern: "next/**", group: "external", position: "before" },
          { pattern: "@/**", group: "internal" },
        ],
        pathGroupsExcludedImportTypes: ["builtin"],
        "newlines-between": "always",
        alphabetize: { order: "asc", caseInsensitive: true },
      },
    ],
  },
};
