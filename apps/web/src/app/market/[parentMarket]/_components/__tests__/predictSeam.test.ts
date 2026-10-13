import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// What `ui-logic-seam` and `bulletproof-web` forbid is a property of the source text, so it is read as text.
const COMPONENTS = path.resolve(import.meta.dirname, "..");
const ROUTE = path.resolve(COMPONENTS, "..");
const FEATURES = path.resolve(import.meta.dirname, "../../../../../features");

const read = (file: string) => readFileSync(file, "utf8");

/** Source files under `dir`, tests excluded. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sources(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const runner = () => read(path.join(COMPONENTS, "PredictRunner.tsx"));

/** Whether `text` pulls PredictRunner into its own module graph. */
const loadsRunnerStatically = (text: string) =>
  /^\s*(?:import|export)\s[^;]*from\s+["'][^"']*\/PredictRunner["']/m.test(text);

describe("PredictRunner stays on its side of the seam", () => {
  it.each(["gnosisRouterAddress", "tradeExecutorFactoryAddress", "sDaiDepositRoute", "@/config/contracts"])(
    "does not resolve execution contracts through %s",
    (name) => {
      expect(runner()).not.toContain(name);
    },
  );

  it.each(["fundsKeyPrefix", "executorKey", "sessionChartKey", "queryKey", "invalidateQueries", "useQueryClient"])(
    "does not reach the query cache through %s",
    (name) => {
      expect(runner()).not.toContain(name);
    },
  );

  it("does not convert estimates to prices itself", () => {
    expect(runner()).not.toContain("estimateToPriceWad");
  });
});

describe("cache invalidation for a prediction sits behind a hook", () => {
  it("is not called from any file in the market route that returns JSX", () => {
    const offenders = sources(ROUTE).filter(
      (file) => file.endsWith(".tsx") && read(file).includes("invalidateQueries"),
    );

    expect(offenders.map((file) => path.relative(ROUTE, file))).toEqual([]);
  });

  it("is owned by a non-JSX hook module in the market route that names every key a run changes", () => {
    const hooks = sources(ROUTE).filter(
      (file) => /^use[A-Z].*\.ts$/.test(path.basename(file)) && read(file).includes("invalidateQueries"),
    );
    const text = hooks.map(read).join("\n");

    expect(hooks.length).toBeGreaterThan(0);
    for (const key of ["fundsKeyPrefix", "executorKey", "sessionChartKey"]) expect(text).toContain(key);
  });
});

describe("the runner is still loaded on demand", () => {
  it("is pulled into the card through a client-only dynamic import", () => {
    const card = read(path.join(COMPONENTS, "PredictCard.tsx"));

    expect(card).toMatch(/dynamic\(\s*\(\)\s*=>\s*import\(\s*["']\.\/PredictRunner["']\s*\)/);
    expect(card).toMatch(/ssr:\s*false/);
  });

  it("is never imported or re-exported statically", () => {
    const statics = sources(path.resolve(FEATURES, "..")).filter((file) => loadsRunnerStatically(read(file)));

    expect(statics.map((file) => path.basename(file))).toEqual([]);
  });

  it.each([
    'import { PredictRunner } from "./PredictRunner";',
    "import {\n  PredictRunner,\n} from '../_components/PredictRunner';",
    'export { PredictRunner } from "./PredictRunner";',
    "export {\n  PredictRunner as Runner,\n} from './PredictRunner';",
    'export * from "@/app/market/[parentMarket]/_components/PredictRunner";',
  ])("counts %j as a static load", (text) => {
    expect(loadsRunnerStatically(text)).toBe(true);
  });

  it("does not count the card's dynamic import as a static load", () => {
    expect(loadsRunnerStatically('const Runner = dynamic(() => import("./PredictRunner"), { ssr: false });')).toBe(
      false,
    );
  });
});

describe("features stay independent of each other", () => {
  const features = readdirSync(FEATURES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  it.each(features)("%s imports no other feature", (feature) => {
    const crossings = sources(path.join(FEATURES, feature)).flatMap((file) =>
      [...read(file).matchAll(/from\s+["']@\/features\/([^/"']+)/g)]
        .map((match) => match[1])
        .filter((target) => target !== feature)
        .map((target) => `${path.relative(FEATURES, file)} -> ${target}`),
    );

    expect(crossings).toEqual([]);
  });

  it("covers predict, sessions and trade-executor", () => {
    expect(features).toEqual(expect.arrayContaining(["predict", "sessions", "trade-executor"]));
  });
});
