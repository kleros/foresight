import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// What `ui-logic-seam` forbids is a property of the source text, so it is read as text.
const FEATURE = path.resolve(import.meta.dirname, "../../../../../../../features/liquidity");
const ROUTE_COMPONENTS = path.resolve(import.meta.dirname, "../../..");

function sources(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sources(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const importsOf = (text: string) =>
  [...text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["'`]([^"'`]+)["'`]/g)].map((match) => match[1]!);

/** The modules that build, size or send a liquidity run. */
const MONEY_MODULE = /(?:liquidity\/|\.\.\/)(?:flow\/(?:plan|math|allowed|abi)|run\/driver)$/;
const MONEY_CALL = /\b(?:planSeed|planRemove|planMerge|createLiquidityRun|encodeFunctionData|sqrtPriceForBps)\b/;

/** Liquidity components: the feature's own, the market page, and the page's components that name liquidity. */
const components = () => [
  ...sources(path.join(FEATURE, "components")),
  ...sources(ROUTE_COMPONENTS).filter(
    (file) => /liquidity|^MarketPage\./i.test(path.basename(file)) && !/^use/.test(path.basename(file)),
  ),
];

describe("the liquidity UI stays on its side of the seam", () => {
  it("has components to hold to it", () => {
    expect(sources(path.join(FEATURE, "components")).length).toBeGreaterThan(0);
  });

  it("imports no plan, math or run module into a component", () => {
    const offenders = components().flatMap((file) =>
      importsOf(readFileSync(file, "utf8"))
        .filter((name) => MONEY_MODULE.test(name))
        .map((name) => `${path.basename(file)} imports ${name}`),
    );
    expect(offenders).toEqual([]);
  });

  it("calls no planner or calldata builder from a component", () => {
    const offenders = components().filter((file) => MONEY_CALL.test(readFileSync(file, "utf8")));
    expect(offenders.map((file) => path.basename(file))).toEqual([]);
  });

  it.each([
    ["the plan", /(?:liquidity\/|^\.\.\/)flow\/plan$/],
    ["the run", /(?:liquidity\/|^\.\.\/)run\/driver$/],
  ])("has a hook that calls %s", (_, module) => {
    const hooks = [
      ...sources(path.join(FEATURE, "hooks")),
      ...sources(ROUTE_COMPONENTS).filter((file) => /^use/.test(path.basename(file))),
    ].filter((file) => importsOf(readFileSync(file, "utf8")).some((name) => module.test(name)));
    expect(hooks.length).toBeGreaterThan(0);
  });
});
