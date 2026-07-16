import { libraryConfig } from "@foresight/eslint-config/library";

/** @type {import("eslint").Linter.Config[]} */
export default [
  {
    ignores: [
      ".prettierrc.cjs",
      "typechain-types/**",
      "deployments/localhost/**",
      "deployments/hardhat/**",
      "deployments/*/solcInputs/**",
    ],
  },
  ...libraryConfig,
];
