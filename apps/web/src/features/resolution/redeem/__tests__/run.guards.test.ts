import { createFlowRunStore, createMemoryStorage, type FlowTx } from "@foresight/tx-orchestrator";
import { getAddress, type Address } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { chain, gateway, wallet } from "./support/world";
import type { ParentResolution } from "../../api/getSessionResolution";
import { planWalletRedeem, type WalletRedeemInput } from "../plan";
import { createRedeemRun } from "../run";

const tamper = vi.hoisted(() => ({ calls: undefined as ((calls: FlowTx[]) => FlowTx[]) | undefined }));

vi.mock("../plan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../plan")>();
  return {
    ...actual,
    planWalletRedeem: (input: WalletRedeemInput) => {
      const plan = actual.planWalletRedeem(input);
      return tamper.calls ? { ...plan, calls: tamper.calls(plan.calls) } : plan;
    },
  };
});

const WAD = 10n ** 18n;
const at = (prefix: string): Address => getAddress(`0x${prefix.padEnd(40, "0")}`);
const OWNER: Address = "0x00000000000000000000000000000000000000a1";
const OTHER: Address = "0x00000000000000000000000000000000000000a2";
const SDAI: Address = "0xaf204776c7245bF4147c2612BF6e5972Ee483701";
const PARENT = at("b0");
const TOKEN_A = at("e00");
const TOKEN_B = at("e01");
const INVALID = at("e02");

const PARENT_RESOLVED: ParentResolution = {
  resolved: true,
  invalid: false,
  winningOutcomes: [0],
  payoutNumerators: [1n, 0n, 0n],
  payoutDenominator: 1n,
};

/** Parent tokens only: one approve and one redeemPositions. */
const INPUT: WalletRedeemInput = {
  chainId: 100,
  owner: OWNER,
  collateral: SDAI,
  parentMarket: PARENT,
  resolution: { parent: PARENT_RESOLVED, children: {} },
  parentTokens: [
    { token: TOKEN_A, balance: 3n * WAD },
    { token: TOKEN_B, balance: WAD },
    { token: INVALID, balance: 0n },
  ],
  childTokens: {},
};

type Run = ReturnType<typeof createRedeemRun>;
const runs: Run[] = [];
afterEach(() => {
  for (const run of runs.splice(0)) run.dispose();
  tamper.calls = undefined;
});

function tab(opts: { balances?: Record<string, bigint>; account?: Address } = {}) {
  const world = chain();
  const sends = gateway(world, OWNER);
  const batch = wallet(world, OWNER);
  let input = INPUT;
  const run = createRedeemRun({
    gateway: sends.port,
    wallet: batch.port,
    reader: {
      ...world.reader,
      balanceOf: (token: Address) =>
        Promise.resolve(opts.balances?.[token] ?? INPUT.parentTokens.find((h) => h.token === token)?.balance ?? 0n),
    },
    store: createFlowRunStore({ storage: createMemoryStorage() }),
    flowId: "redeem-guards",
    account: () => opts.account ?? OWNER,
    chainId: () => 100,
    request: () => input,
    now: () => 1_700_000_000_000,
    pollMs: 5,
  });
  runs.push(run);
  return { run, sends, world, setInput: (next: WalletRedeemInput) => (input = next) };
}

const settled = (run: Run) =>
  vi.waitFor(() => expect(["complete", "halted", "review"]).toContain(run.getProgress().stage), { timeout: 3_000 });

let PLANNED: FlowTx[] = [];
beforeEach(() => {
  PLANNED = planWalletRedeem(INPUT).calls;
});

describe("createRedeemRun R6 signs only what was shown", () => {
  it("stops as changed, signing nothing, when a balance it redeems differs from the shown one", async () => {
    const { run, sends } = tab({ balances: { [TOKEN_A]: 3n * WAD - 1n } });

    run.start();
    await settled(run);

    expect(run.getProgress()).toEqual({ stage: "halted", failure: { reason: "changed", retryable: false } });
    expect(sends.prompts).toEqual([]);
  });

  it("redeems when every balance it redeems still holds the shown amount", async () => {
    const { run, sends } = tab();

    run.start();
    await settled(run);

    expect(run.getProgress().stage).toBe("complete");
    expect(sends.prompts).toHaveLength(PLANNED.length);
  });
});

describe("createRedeemRun R8 decodes every call before the wallet opens", () => {
  it("stops as unlisted, with no prompt, when a call carries native value", async () => {
    tamper.calls = (calls) => calls.map((call, index) => (index === 0 ? { ...call, value: 1n } : call));
    const { run, sends } = tab();

    run.start();
    await settled(run);

    expect(run.getProgress()).toEqual({ stage: "halted", failure: { reason: "unlisted", retryable: false } });
    expect(sends.prompts).toEqual([]);
  });

  it("stops as unlisted when an approve names a spender outside the allow-list", async () => {
    tamper.calls = (calls) =>
      calls.map((call) =>
        call.data!.startsWith("0x095ea7b3")
          ? { ...call, data: call.data!.replace(/^(0x095ea7b3.{24}).{40}/, `$1${"ab".repeat(20)}`) as `0x${string}` }
          : call,
      );
    const { run, sends } = tab();

    run.start();
    await settled(run);

    expect(run.getProgress().failure).toEqual({ reason: "unlisted", retryable: false });
    expect(sends.prompts).toEqual([]);
  });
});

describe("createRedeemRun who and when", () => {
  it("refuses to start for an account other than the one the shown list was read for", async () => {
    const { run, sends } = tab({ account: OTHER });

    run.start();
    await settled(run);

    expect(run.getProgress().failure).toEqual({ reason: "wrong-wallet", retryable: true });
    expect(sends.prompts).toEqual([]);
  });

  it("starts a fresh run on the next press once a run completed", async () => {
    const { run, sends, setInput } = tab();
    run.start();
    await settled(run);
    expect(run.getProgress().stage).toBe("complete");

    // the fake balances do not follow what mined, so the next list shows the same winning balance
    setInput({ ...INPUT });
    run.start();
    await vi.waitFor(() => expect(sends.prompts).toHaveLength(2 * PLANNED.length));
    await settled(run);

    expect(run.getProgress()).toEqual({ stage: "complete" });
  });
});
