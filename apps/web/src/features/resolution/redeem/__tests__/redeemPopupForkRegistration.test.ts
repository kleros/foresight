// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const WEB_ROOT = path.resolve(import.meta.dirname, "../../../../..");
const SCRIPT = path.join(WEB_ROOT, "scripts/test-fork-redeem.sh");
const POPUP_SUITE_FILE = "predict.fork.redeem.popup.test.ts";
const EARLIER_SUITE_FILES = [
  "predict.fork.resolution.test.ts",
  "predict.fork.redeem.tradeWallet.test.ts",
  "predict.fork.redeem.connectedWallet.test.ts",
];

function registeredSuites(): string[] {
  const match = readFileSync(SCRIPT, "utf8").match(/^REGISTERED_SUITES="([^"]*)"/m);
  if (!match) throw new Error("The fork script declares no REGISTERED_SUITES.");
  return match[1]!.split(/\s+/).filter(Boolean);
}

/** Test files under `src`, relative to the web root; a vitest filter selects the paths that contain it. */
const testFiles = readdirSync(path.join(WEB_ROOT, "src"), { recursive: true, encoding: "utf8" })
  .filter((file) => /\.test\.tsx?$/.test(file))
  .map((file) => path.join("src", file));

const selects = (suite: string, file: string) => testFiles.some((each) => each.includes(suite) && each.endsWith(file));

describe("A3 the fork script's registered suites", () => {
  it("include one that selects the Redeem popup's fork suite", () => {
    expect(existsSync(path.join(import.meta.dirname, POPUP_SUITE_FILE))).toBe(true);
    expect(registeredSuites().some((suite) => selects(suite, POPUP_SUITE_FILE))).toBe(true);
  });

  it("still include the resolution and both earlier redeem suites", () => {
    for (const file of EARLIER_SUITE_FILES) {
      expect(registeredSuites().some((suite) => selects(suite, file))).toBe(true);
    }
  });
});
