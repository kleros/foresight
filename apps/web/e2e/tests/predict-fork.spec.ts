import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { LOCAL_RPC_URL } from "@/config/chains";

import { expect, test } from "../fixtures";

/**
 * A session seeded on the gnosis fork, on its predict page. Needs `yarn local-stack gnosis-fork`;
 * against the plain localhost stack it skips.
 */

const GNOSIS_CHAIN_ID = 100;
const exec = promisify(execFile);

async function chainId(): Promise<number | null> {
  const response = await fetch(LOCAL_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
  }).catch(() => null);
  if (!response?.ok) return null;
  return Number(((await response.json()) as { result: string }).result);
}

/** Seeds a session with pools the way an agent would, and returns its parent market. */
async function seedSession(): Promise<string> {
  const { stdout: root } = await exec("git", ["rev-parse", "--show-toplevel"]);
  const { stdout } = await exec("yarn", ["simulate:session:gnosis-fork", "--liquidity"], {
    cwd: root.trim(),
    maxBuffer: 16 * 1024 * 1024,
  });
  const parent = stdout.match(/parent\s+(0x[0-9a-fA-F]{40})/)?.[1];
  if (!parent) throw new Error(`The seed printed no parent market:\n${stdout}`);
  return parent;
}

test.describe("a session seeded on the gnosis fork", () => {
  test.describe.configure({ mode: "serial" });

  const parents: string[] = [];

  test.beforeAll(async () => {
    test.skip((await chainId()) !== GNOSIS_CHAIN_ID, "needs `yarn local-stack gnosis-fork`");
    test.setTimeout(900_000);
    const { stdout: root } = await exec("git", ["rev-parse", "--show-toplevel"]);
    await exec("yarn", ["workspace", "@foresight/contracts", "build"], { cwd: root.trim() });
    parents.push(await seedSession());
    parents.push(await seedSession());
  });

  for (const [index, which] of ["first", "second"].entries()) {
    test(`the ${which} seeded session is trading and Predict enables once an estimate moves`, async ({
      page,
      wallet,
      indexer,
    }) => {
      await indexer.caughtUp();
      const parent = parents[index]!;

      await page.goto(`/market/${parent}`);
      await wallet.connect("alice");

      // the countdown is shown only while the session is trading
      await expect(page.getByText("Countdown")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText("Closed", { exact: true })).toHaveCount(0);

      const predict = page.getByRole("button", { name: "Predict selected" });
      await expect(predict).toBeVisible();
      await expect(predict).toBeDisabled();

      // each option is a collapsed card whose slider renders once it is opened
      await page
        .getByRole("button")
        .filter({ has: page.getByRole("heading", { level: 3 }) })
        .first()
        .click();
      const slider = page.getByRole("slider").first();
      await expect(slider).toBeEnabled({ timeout: 30_000 });
      await slider.focus();
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowRight");

      await expect(predict).toBeEnabled();
    });
  }
});
