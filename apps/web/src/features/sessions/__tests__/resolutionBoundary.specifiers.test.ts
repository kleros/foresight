import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import { describe, expect, it } from "vitest";

/** Vitest runs from apps/web. */
const SRC = join(process.cwd(), "src");
const SESSIONS = join(SRC, "features/sessions");
const RESOLUTION = join(SRC, "features/resolution");
const SOURCE = /\.(ts|tsx)$/;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sources(path);
    return SOURCE.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** Every module named by `from`, `import(...)` (value or inline type) or `require(...)`. */
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["'`]([^"'`]+)["'`]/gm;

function target(file: string, specifier: string): string | undefined {
  if (specifier.startsWith("@/")) return join(SRC, specifier.slice(2));
  if (specifier.startsWith(".")) return resolve(dirname(file), specifier);
  return undefined;
}

const inResolution = (path: string) => path === RESOLUTION || path.startsWith(RESOLUTION + sep);

function reachesResolution(file: string, text: string): boolean {
  return [...text.matchAll(SPECIFIER)].some(([, specifier]) => {
    const path = target(file, specifier!);
    return path !== undefined && inResolution(path);
  });
}

describe("A7 no module specifier under features/sessions resolves into features/resolution", () => {
  it("catches each way of writing the path", () => {
    const file = join(SESSIONS, "types.ts");
    for (const text of [
      'import type { X } from "@/features/resolution/api/getSessionResolution";',
      'type R = import("./../resolution/api/getSessionResolution").ParentResolution["resolved"];',
      'type R = import("../resolution/api/getSessionResolution").ParentResolution;',
      'const m = await import("../../features/resolution/api/useSessionResolution");',
      'const m = require("./../resolution");',
      'export { x } from "../resolution/api/useSessionResolution";',
      'import "@/features/resolution/api/useSessionResolution";',
    ]) {
      expect(reachesResolution(file, text), text).toBe(true);
    }
    expect(reachesResolution(file, 'import { y } from "./utils/statusChip";')).toBe(false);
  });

  it("finds none in the sources", () => {
    const files = sources(SESSIONS);
    expect(files.length).toBeGreaterThan(5);

    const offending = files.filter((file) => reachesResolution(file, readFileSync(file, "utf8")));

    expect(offending.map((file) => relative(SESSIONS, file))).toEqual([]);
  });
});
