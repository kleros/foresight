import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(import.meta.dirname, "..");
const SHARED = ["components", "hooks", "lib", "utils", "types", "config"].filter((layer) =>
  existsSync(path.join(SRC, layer)),
);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sources(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function imports(text: string): string[] {
  const found: string[] = [];
  const source = ts.createSourceFile("source.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function visit(node: ts.Node) {
    const specifier =
      ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
        ? node.moduleSpecifier
        : ts.isCallExpression(node) &&
            (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
              (ts.isIdentifier(node.expression) && node.expression.text === "require"))
          ? node.arguments[0]
          : undefined;
    if (specifier && (ts.isStringLiteral(specifier) || ts.isNoSubstitutionTemplateLiteral(specifier))) {
      found.push(specifier.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
}

function layerOf(file: string): string {
  const [top, name] = path.relative(SRC, file).split(path.sep);
  return top === "features" ? `${top}/${name}` : (top ?? "");
}

function crossings(layer: string): string[] {
  return sources(path.join(SRC, layer)).flatMap((file) =>
    imports(readFileSync(file, "utf8"))
      .flatMap((specifier) =>
        specifier.startsWith("@/")
          ? [path.join(SRC, specifier.slice(2))]
          : specifier.startsWith(".")
            ? [path.resolve(path.dirname(file), specifier)]
            : [],
      )
      .map(layerOf)
      .filter((target) => target === "app" || (target.startsWith("features/") && target !== layer))
      .map((target) => `${path.relative(SRC, file)} -> ${target}`),
  );
}

describe("feature and shared-layer imports", () => {
  const features = readdirSync(path.join(SRC, "features"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `features/${entry.name}`);

  it.each([...features, ...SHARED])("%s does not reach another feature or the app", (layer) => {
    expect(crossings(layer)).toEqual([]);
  });

  it.each([
    'import { value } from "@/features/other/value";',
    'export { value } from "@/features/other/value";',
    'import "@/features/other/value";',
    'import("@/features/other/value");',
    "import(`@/features/other/value`);",
    'require("@/features/other/value");',
    "require(`@/features/other/value`);",
  ])("reads the dependency in %s", (text) => {
    expect(imports(text)).toEqual(["@/features/other/value"]);
  });

  it("ignores import examples in comments and strings", () => {
    expect(imports('// import("@/features/other/value");\nconst example = "require(whatever)";')).toEqual([]);
  });
});
