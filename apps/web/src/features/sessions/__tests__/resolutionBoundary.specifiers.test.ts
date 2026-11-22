import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import ts from "typescript";
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

/** Every string literal the parser finds, so a specifier is caught in any import form and comments never count. */
function literals(file: string, text: string): string[] {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) found.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Only `@/` (tsconfig paths) and relative paths reach src; there is no baseUrl. */
function target(file: string, specifier: string): string | undefined {
  if (specifier.startsWith("@/")) return join(SRC, specifier.slice(2));
  if (specifier.startsWith(".")) return resolve(dirname(file), specifier);
  return undefined;
}

const inResolution = (path: string) => path === RESOLUTION || path.startsWith(RESOLUTION + sep);

function reachesResolution(file: string, text: string): boolean {
  return literals(file, text).some((specifier) => {
    const path = target(file, specifier);
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
      'type R = import(/**/ "@/features/resolution/api/getSessionResolution").ParentResolution["resolved"];',
      'type R = import(\n  // a reason\n  "../resolution/api/getSessionResolution"\n).ParentResolution;',
      'type R = typeof import("@/features/../features/resolution/api/useSessionResolution");',
      'import type {\n  X,\n} from /* c */ "@/features/resolution";',
      "const m = await import(`../resolution/api/useSessionResolution`);",
      'const m = await import("../../features/resolution/api/useSessionResolution");',
      'const m = require("./../resolution");',
      'import m = require("../resolution/api/getSessionResolution");',
      'export { x } from "../resolution/api/useSessionResolution";',
      'export * from "@/features/resolution";',
      'import "@/features/resolution/api/useSessionResolution";',
    ]) {
      expect(reachesResolution(file, text), text).toBe(true);
    }
    for (const text of [
      'import { y } from "./utils/statusChip";',
      '// the route reads "@/features/resolution" and passes the value in',
      '/* import("../resolution/api/getSessionResolution") */ export type R = boolean;',
    ]) {
      expect(reachesResolution(file, text), text).toBe(false);
    }
  });

  it("finds none in the sources", () => {
    const files = sources(SESSIONS);
    expect(files.length).toBeGreaterThan(5);

    const offending = files.filter((file) => reachesResolution(file, readFileSync(file, "utf8")));

    expect(offending.map((file) => relative(SESSIONS, file))).toEqual([]);
  });
});
