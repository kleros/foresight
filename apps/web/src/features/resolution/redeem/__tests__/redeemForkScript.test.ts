// @vitest-environment node
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * The fork script run against a stand-in vitest, found through a stand-in `yarn bin`: what the script asks vitest to
 * run, and what it makes of vitest's JSON report, with no fork node.
 */

const WEB_ROOT = path.resolve(import.meta.dirname, "../../../../..");
const SCRIPT = path.join(WEB_ROOT, "scripts/test-fork-redeem.sh");
const REDEEM_FILE = "src/features/resolution/redeem/__tests__/predict.fork.redeem.tradeWallet.test.ts";
const RESOLUTION_FILE = "src/features/resolution/api/__tests__/predict.fork.resolution.test.ts";

const STUB_VITEST = `
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "list") {
  const suite = args[args.length - 1];
  console.log(JSON.parse(process.env.STUB_FILES).filter((file) => file.includes(suite)).join("\\n"));
  process.exit(0);
}
fs.appendFileSync(process.env.STUB_ARGS, JSON.stringify(args) + "\\n");
const report = args.find((arg) => arg.startsWith("--outputFile.json=")).slice("--outputFile.json=".length);
fs.writeFileSync(report, process.env.STUB_REPORT);
process.exit(Number(process.env.STUB_EXIT || 0));
`;

const registered = () =>
  readFileSync(SCRIPT, "utf8")
    .match(/^REGISTERED_SUITES="([^"]*)"/m)![1]!
    .split(/\s+/);

type Status = "passed" | "failed" | "skipped" | "pending";
const report = (files: Record<string, Status[]>) =>
  JSON.stringify({
    testResults: Object.entries(files).map(([file, statuses]) => ({
      name: path.join(WEB_ROOT, file),
      assertionResults: statuses.map((status) => ({ status })),
    })),
  });

let stubs: string;

beforeEach(() => {
  stubs = mkdtempSync(path.join(tmpdir(), "fork-script-"));
  writeFileSync(path.join(stubs, "vitest.cjs"), STUB_VITEST);
  writeFileSync(path.join(stubs, "yarn"), `#!/bin/sh\n[ "$1" = bin ] && echo "${stubs}/vitest.cjs"\n`);
  chmodSync(path.join(stubs, "yarn"), 0o755);
});

afterEach(() => rmSync(stubs, { recursive: true, force: true }));

function runScript(options: { report: string; files?: string[]; exit?: number; args?: string[] }) {
  const argsFile = path.join(stubs, "args.jsonl");
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("VITEST")) delete env[key];
  const result = spawnSync("sh", [SCRIPT, ...(options.args ?? [])], {
    encoding: "utf8",
    env: {
      ...env,
      PATH: `${stubs}${path.delimiter}${env.PATH}`,
      STUB_FILES: JSON.stringify(options.files ?? [REDEEM_FILE, RESOLUTION_FILE]),
      STUB_REPORT: options.report,
      STUB_EXIT: String(options.exit ?? 0),
      STUB_ARGS: argsFile,
    },
  });
  let runs: string[][] = [];
  try {
    runs = readFileSync(argsFile, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    // vitest was never run
  }
  return { status: result.status, stderr: result.stderr, runs };
}

const ALL_PASSED = report({ [REDEEM_FILE]: ["passed", "passed"], [RESOLUTION_FILE]: ["passed"] });

describe("A9 the fork script, against a stand-in vitest", () => {
  it("runs vitest once over exactly the registered suites, the redeem suite among them, with no test filter", () => {
    const { status, runs } = runScript({ report: ALL_PASSED });

    expect(status).toBe(0);
    expect(runs).toHaveLength(1);
    const [run] = runs;
    expect(run!.slice(0, 4)).toEqual(["run", "--no-file-parallelism", "--reporter=default", "--reporter=json"]);
    expect(run![4]).toMatch(/^--outputFile\.json=/);
    expect(run!.slice(5)).toEqual(registered());
    expect(registered()).toContain("fork.redeem.tradeWallet");
  });

  it("fails, naming the suite, when every test of the redeem suite was skipped", () => {
    const { status, stderr } = runScript({
      report: report({ [REDEEM_FILE]: ["skipped", "skipped", "pending"], [RESOLUTION_FILE]: ["passed"] }),
    });

    expect(status).not.toBe(0);
    expect(stderr).toContain("fork.redeem.tradeWallet");
    expect(stderr).not.toContain("fork.resolution");
  });

  it("fails when the redeem suite is missing from the report", () => {
    const { status, stderr } = runScript({ report: report({ [RESOLUTION_FILE]: ["passed"] }) });

    expect(status).not.toBe(0);
    expect(stderr).toContain("fork.redeem.tradeWallet");
  });

  it("fails when vitest fails", () => {
    expect(runScript({ report: ALL_PASSED, exit: 1 }).status).toBe(1);
  });

  it("fails before running vitest when a registered suite matches no test file", () => {
    const { status, stderr, runs } = runScript({ report: ALL_PASSED, files: [RESOLUTION_FILE] });

    expect(status).toBe(1);
    expect(stderr).toContain("fork.redeem.tradeWallet");
    expect(runs).toEqual([]);
  });
});
