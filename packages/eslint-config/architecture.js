import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import { importX } from "eslint-plugin-import-x";

/**
 * Bulletproof React's unidirectional architecture, enforced.
 *
 *   shared (components, hooks, lib, utils, types, config, assets, styles)
 *     -> features
 *       -> app
 *
 * Imports may only point down that list. Concretely:
 *   - a feature never imports another feature - routes compose features instead
 *   - features never import from `app`
 *   - shared layers never import from `features` or `app`
 *
 * Feature folders are discovered from disk, so a new `src/features/<name>` is
 * fenced off the moment it exists.
 *
 * @see https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md
 */

const SHARED_LAYERS = [
  "./src/components",
  "./src/hooks",
  "./src/lib",
  "./src/utils",
  "./src/types",
  "./src/config",
  "./src/assets",
  "./src/styles",
];

const listFeatures = (cwd) => {
  const featuresDir = path.join(cwd, "src", "features");
  if (!existsSync(featuresDir)) return [];

  return readdirSync(featuresDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
};

const restrictedPaths = importX.rules["no-restricted-paths"];

/**
 * import-x's no-restricted-paths, over the two module references it does not visit:
 * `import("…")` in a type and `import x = require("…")`.
 */
const typeReferencePaths = {
  meta: restrictedPaths.meta,
  defaultOptions: restrictedPaths.defaultOptions,
  create(context) {
    const visitors = restrictedPaths.create(context);
    const check = (source) => {
      if (source?.type === "Literal" && typeof source.value === "string") {
        visitors.ImportDeclaration({ type: "ImportDeclaration", source });
      }
    };
    return {
      TSImportType: (node) => check(node.source ?? node.argument?.literal),
      TSExternalModuleReference: (node) => check(node.expression),
    };
  },
};

const featureZones = (appRoot) =>
  listFeatures(appRoot).map((feature) => ({
    target: `./src/features/${feature}`,
    from: "./src/features",
    except: [`./${feature}`],
    message: `Cross-feature import. Compose features in a route, or promote the shared part into src/components, src/hooks, src/lib or src/utils.`,
  }));

/**
 * `appRoot` is required, deliberately. Every zone resolves against it, so a wrong root
 * matches no files and the rule reports clean while enforcing nothing. There is no safe
 * default: `process.cwd()` is whatever invoked ESLint - the app dir under `yarn lint`,
 * the repo root from an editor or a root-level run.
 *
 * Call it from the app's own flat config, where `import.meta.dirname` is the app root:
 *
 *   // apps/<app>/eslint.config.mjs
 *   export default [...nextJsConfig, architectureConfig(import.meta.dirname)];
 *
 * @param {string} appRoot Root of the app being linted - pass `import.meta.dirname`.
 * @returns {import("eslint").Linter.Config}
 */
export const architectureConfig = (appRoot) => {
  if (typeof appRoot !== "string" || appRoot === "") {
    throw new TypeError(
      "architectureConfig(appRoot): pass the app root, e.g. architectureConfig(import.meta.dirname).",
    );
  }

  if (!existsSync(path.join(appRoot, "src"))) {
    throw new Error(
      `architectureConfig(appRoot): no "src" directory under ${appRoot}. ` +
        "Zones resolve against this path, so the wrong root would silently enforce nothing.",
    );
  }

  const restrictedPathsOptions = [
    "error",
    {
      basePath: appRoot,
      zones: [
        ...featureZones(appRoot),
        {
          target: "./src/features",
          from: "./src/app",
          message: "Features cannot import from the app layer - dependencies flow shared -> features -> app.",
        },
        {
          target: SHARED_LAYERS,
          from: ["./src/features", "./src/app"],
          message: "Shared layers cannot import from features or app - they must stay reusable in isolation.",
        },
      ],
    },
  ];

  return {
    files: ["src/**/*.{ts,tsx,js,jsx}"],
    plugins: {
      "import-x": importX,
      architecture: { rules: { "no-restricted-type-references": typeReferencePaths } },
    },
    // The zones match on resolved file paths, so `@/*` has to resolve through tsconfig.
    settings: {
      "import-x/resolver-next": [createTypeScriptImportResolver()],
    },
    rules: {
      "import-x/no-restricted-paths": restrictedPathsOptions,
      "architecture/no-restricted-type-references": restrictedPathsOptions,
    },
  };
};
