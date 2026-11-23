import {
  createFlowRunStore,
  createMemoryStorage,
  type BalanceTxGateway,
  type FlowTx,
} from "@foresight/tx-orchestrator";
import { getAddress, type Address } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { chain, gateway, timesBroadcast, wallet } from "./support/world";
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

function tab(
  opts: {
    balances?: Record<string, bigint>;
    account?: Address;
    chainId?: number;
    /** What wallet_getCapabilities reports as the chain's atomic status; none by default. */
    atomic?: string;
    /** The first wallet_sendCalls is answered with an error of this code. */
    sendCallsRefuse?: number;
    /** The first one-by-one send is answered with an error of this code, opening no prompt. */
    sendRefuse?: number;
    /** Called as the n-th one-by-one prompt opens. */
    onPrompt?: (index: number) => void;
  } = {},
) {
  const world = chain();
  const sends = gateway(world, OWNER);
  const batch = wallet(
    world,
    OWNER,
    opts.sendCallsRefuse === undefined ? {} : { sendCallsRefuse: opts.sendCallsRefuse },
  );
  let input = INPUT;
  let asked = 0;
  const port: BalanceTxGateway = {
    ...sends.port,
    sendTransaction: (tx, options) => {
      const index = asked++;
      if (index === 0 && opts.sendRefuse !== undefined) {
        return Promise.reject(
          Object.assign(new Error("The wallet cannot take this request."), { code: opts.sendRefuse }),
        );
      }
      opts.onPrompt?.(index);
      return sends.port.sendTransaction(tx, options);
    },
  };
  const walletPort = {
    request: (args: { method: string; params?: unknown }) =>
      args.method === "wallet_getCapabilities" && opts.atomic !== undefined
        ? Promise.resolve({ "0x64": { atomic: { status: opts.atomic } } })
        : batch.port.request(args),
  };
  const run = createRedeemRun({
    gateway: port,
    wallet: walletPort,
    reader: {
      ...world.reader,
      balanceOf: (token: Address) =>
        Promise.resolve(opts.balances?.[token] ?? INPUT.parentTokens.find((h) => h.token === token)?.balance ?? 0n),
    },
    store: createFlowRunStore({ storage: createMemoryStorage() }),
    flowId: "redeem-guards",
    account: () => opts.account ?? OWNER,
    chainId: () => opts.chainId ?? 100,
    request: () => input,
    now: () => 1_700_000_000_000,
    pollMs: 5,
  });
  runs.push(run);
  return { run, sends, batch, world, setInput: (next: WalletRedeemInput) => (input = next) };
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
  it("stops as changed before a redeem when an earlier approve's balance moved after it was signed", async () => {
    const twoWinners: WalletRedeemInput = {
      ...INPUT,
      resolution: {
        parent: { ...PARENT_RESOLVED, winningOutcomes: [0, 1], payoutNumerators: [1n, 1n, 0n], payoutDenominator: 2n },
        children: {},
      },
    };
    const calls = planWalletRedeem(twoWinners).calls;
    expect(calls.map((call) => call.data!.slice(0, 10))).toEqual(["0x095ea7b3", "0x095ea7b3", "0x865955a0"]);
    const balances: Record<string, bigint> = {};
    const { run, sends, setInput } = tab({
      balances,
      onPrompt: (index) => {
        if (index === 0) balances[TOKEN_A] = 3n * WAD - 1n;
      },
    });
    setInput(twoWinners);

    run.start();
    await settled(run);

    expect(run.getProgress()).toEqual({ stage: "halted", failure: { reason: "changed", retryable: false } });
    expect(sends.prompts.map((tx) => tx.data)).toEqual(calls.slice(0, 2).map((tx) => tx.data));
  });

  it("atomic: stops as changed, sending no batch, when a balance it redeems differs from the shown one", async () => {
    const { run, batch } = tab({ atomic: "supported", balances: { [TOKEN_A]: 3n * WAD - 1n } });

    run.start();
    await settled(run);

    expect(run.getProgress()).toEqual({ stage: "halted", failure: { reason: "changed", retryable: false } });
    expect(batch.sendCalls).toEqual([]);
  });

  it("starts a new review's run on the next press after stopping as changed", async () => {
    const balances: Record<string, bigint> = { [TOKEN_A]: 3n * WAD - 1n };
    const { run, sends, setInput } = tab({ balances });
    run.start();
    await settled(run);
    expect(run.getProgress().failure).toEqual({ reason: "changed", retryable: false });

    const reread = {
      ...INPUT,
      parentTokens: [{ token: TOKEN_A, balance: 3n * WAD - 1n }, ...INPUT.parentTokens.slice(1)],
    };
    setInput(reread);
    run.start();
    await vi.waitFor(() => expect(run.getProgress().stage).toBe("complete"), { timeout: 3_000 });

    expect(sends.prompts.map((tx) => tx.data)).toEqual(planWalletRedeem(reread).calls.map((tx) => tx.data));
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

describe("createRedeemRun picks atomic or one by one from the wallet's capabilities", () => {
  it.each(["supported", "ready"])("sends one atomic batch when the wallet reports atomic %s", async (status) => {
    const { run, sends, batch } = tab({ atomic: status });

    run.start();
    await settled(run);

    expect(run.getProgress().stage).toBe("complete");
    expect(batch.sendCalls).toHaveLength(1);
    expect(sends.prompts).toEqual([]);
  });

  it("signs one by one when the wallet reports atomic unsupported", async () => {
    const { run, sends, batch } = tab({ atomic: "unsupported" });

    run.start();
    await settled(run);

    expect(batch.sendCalls).toEqual([]);
    expect(sends.prompts).toHaveLength(PLANNED.length);
  });
});

/** Wallet answers that open no prompt (liquidity oracle L8). */
const NO_PROMPT = [4100, 4200, -32601, -32602, 3, 5700, 5710, 5740, 5750, 5760];

describe("createRedeemRun after a wallet answer that opened no prompt", () => {
  it.each(NO_PROMPT)("one by one: code %i stops as wallet, and the retry signs each call once", async (code) => {
    const { run, sends, world } = tab({ sendRefuse: code });

    run.start();
    await settled(run);
    expect(run.getProgress()).toEqual({ stage: "halted", failure: { reason: "wallet", retryable: true } });

    run.retry();
    await vi.waitFor(() => expect(run.getProgress().stage).toBe("complete"), { timeout: 3_000 });
    expect(sends.prompts).toHaveLength(PLANNED.length);
    expect(timesBroadcast(world, PLANNED)).toEqual(PLANNED.map(() => 1));
  });

  it.each(NO_PROMPT)("atomic: code %i stops as wallet, and the retry sends the batch", async (code) => {
    const { run, batch } = tab({ atomic: "supported", sendCallsRefuse: code });

    run.start();
    await settled(run);
    expect(run.getProgress()).toEqual({ stage: "halted", failure: { reason: "wallet", retryable: true } });

    run.retry();
    await vi.waitFor(() => expect(run.getProgress().stage).toBe("complete"), { timeout: 3_000 });
    expect(batch.sendCalls).toHaveLength(2);
  });
});

describe("createRedeemRun who and when", () => {
  it("refuses to start while the wallet is on another chain than the shown list's", async () => {
    const { run, sends } = tab({ chainId: 1 });

    run.start();
    await settled(run);

    expect(run.getProgress().failure).toEqual({ reason: "wrong-chain", retryable: true });
    expect(sends.prompts).toEqual([]);
  });

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
