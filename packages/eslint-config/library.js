import eslintConfigPrettier from "eslint-config-prettier";
import { config as baseConfig } from "./base.js";

/**
 * ESLint flat config for TypeScript packages (no React).
 * eslint-config-prettier must be last.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export const libraryConfig = [...baseConfig, eslintConfigPrettier];
