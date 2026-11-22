import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/** features/sessions may not reach features/resolution in any form; the route composes the two. */
/** Vitest runs from apps/web. */
const SESSIONS = join(process.cwd(), "src/features/sessions");
const SOURCE = /\.(ts|tsx)$/;
const TEST = /(__tests__|\.test\.tsx?$)/;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sources(path);
    return SOURCE.test(entry.name) && !TEST.test(path) ? [path] : [];
  });
}

const REFERENCES = [
  /from\s+["'][^"']*features\/resolution[^"']*["']/,
  /import\(\s*["'][^"']*features\/resolution[^"']*["']\s*\)/,
  /require\(\s*["'][^"']*features\/resolution[^"']*["']\s*\)/,
  /from\s+["'](\.\.\/)+resolution[^"']*["']/,
  /import\(\s*["'](\.\.\/)+resolution[^"']*["']\s*\)/,
];

describe("A7 features/sessions does not import features/resolution", () => {
  it("has sources to check", () => {
    expect(sources(SESSIONS).length).toBeGreaterThan(5);
  });

  it("no source under features/sessions names features/resolution, statically, dynamically or as an inline type", () => {
    const offending = sources(SESSIONS).filter((path) => {
      const text = readFileSync(path, "utf8");
      return REFERENCES.some((pattern) => pattern.test(text));
    });

    expect(offending.map((path) => relative(SESSIONS, path))).toEqual([]);
  });
});
