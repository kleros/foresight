// @vitest-environment node
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

/**
 * The predict-flow epic's loop, from an agent's side: seed the fork, then `yarn test:fork`.
 * Needs `yarn local-stack gnosis-fork` running; run with
 * `FORK_RPC_URL=http://127.0.0.1:8545 yarn workspace web vitest run feedback-loop.fork`.
 * Not matched by `test:fork`'s `predict.fork` filter, which these tests invoke.
 */
const FORK_RPC_URL = process.env.FORK_RPC_URL;
const HASURA_URL = process.env.FORK_HASURA_URL ?? "http://localhost:8080/v1/graphql";
const HASURA_SECRET = process.env.FORK_HASURA_SECRET ?? "testing";

/** What a fresh shell has: nothing the app's env files would have loaded into this process. */
const SHELL_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "LANG",
  "TERM",
  "VOLTA_HOME",
  "COREPACK_HOME",
];
const shellEnv = Object.fromEntries(
  SHELL_KEYS.flatMap((key) => (process.env[key] === undefined ? [] : [[key, process.env[key]!]])),
) as NodeJS.ProcessEnv;

interface Run {
  code: number | null;
  output: string;
}

function run(command: string, args: string[], cwd: string): Promise<Run> {
  return new Promise((resolve) => {
    execFile(command, args, { cwd, env: shellEnv, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
      resolve({ code, output: `${stdout}\n${stderr}` });
    });
  });
}

async function runOk(command: string, args: string[], cwd: string): Promise<string> {
  const result = await run(command, args, cwd);
  if (result.code !== 0) throw new Error(`${command} ${args.join(" ")} exited ${result.code}\n${result.output}`);
  return result.output;
}

const repoRoot = async () => (await runOk("git", ["rev-parse", "--show-toplevel"], process.cwd())).trim();

/** Seeds a session on the fork and holds until the indexer has it. Returns its id. */
async function seedSession(root: string, { liquidity }: { liquidity: boolean }): Promise<string> {
  const output = await runOk("yarn", ["simulate:session:gnosis-fork", ...(liquidity ? ["--liquidity"] : [])], root);
  const sessionId = output.match(/Session #(\d+)/)?.[1];
  if (sessionId === undefined) throw new Error(`The seed printed no session id:\n${output}`);

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const response = await fetch(HASURA_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-hasura-admin-secret": HASURA_SECRET },
      body: JSON.stringify({ query: `{ Session(where: {sessionId: {_eq: "${sessionId}"}}) { id } }` }),
    });
    const body = (await response.json()) as { data?: { Session: unknown[] } };
    if (body.data?.Session.length) return sessionId;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`The indexer never picked up session #${sessionId}.`);
}

/** The `Tests` count line of a vitest run, which says whether anything ran rather than skipped. */
function testsLine(output: string): string {
  // eslint-disable-next-line no-control-regex -- vitest colours its summary even off a TTY
  const plain = output.replace(/\x1b\[[0-9;]*m/g, "");
  const line = plain.split("\n").find((each) => /^\s*Tests\s/.test(each));
  if (!line) throw new Error(`vitest printed no Tests line:\n${output}`);
  return line;
}

function expectForkSuitePassed(result: Run) {
  expect(result.code, result.output).toBe(0);
  const line = testsLine(result.output);
  expect(line).toMatch(/\d+ passed/);
  expect(line).not.toMatch(/failed|skipped/);
}

describe("the predict-flow feedback loop, against a gnosis fork", () => {
  const worktrees: string[] = [];

  afterAll(async () => {
    const root = await repoRoot();
    for (const dir of worktrees) {
      await run("git", ["worktree", "remove", "--force", dir], root);
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it.skipIf(!FORK_RPC_URL)(
    "passes `yarn test:fork` in a fresh worktree that has no gitignored files",
    async () => {
      const root = await repoRoot();
      await runOk("yarn", ["workspace", "@foresight/contracts", "build"], root);
      await seedSession(root, { liquidity: true });

      const dir = mkdtempSync(path.join(tmpdir(), "foresight-loop-"));
      rmSync(dir, { recursive: true, force: true });
      worktrees.push(dir);
      await runOk("git", ["worktree", "add", "--detach", dir, "HEAD"], root);

      // a fresh checkout carries no env file, no install, nothing ignored
      expect(await runOk("git", ["status", "--ignored", "--porcelain"], dir)).not.toMatch(/^!!/m);

      await runOk("yarn", ["install", "--immutable"], dir);
      expectForkSuitePassed(await run("yarn", ["test:fork"], dir));
    },
    1_200_000,
  );

  it.skipIf(!FORK_RPC_URL)(
    "picks a session with pools when a session without liquidity was opened after it",
    async () => {
      const root = await repoRoot();
      await runOk("yarn", ["workspace", "@foresight/contracts", "build"], root);
      await seedSession(root, { liquidity: true });
      await seedSession(root, { liquidity: false });

      expectForkSuitePassed(await run("yarn", ["test:fork"], root));
    },
    900_000,
  );
});
