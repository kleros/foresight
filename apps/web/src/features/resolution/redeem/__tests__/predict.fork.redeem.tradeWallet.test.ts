// @vitest-environment node
import { execFileSync } from "node:child_process";
import path from "node:path";

import type { FlowTx } from "@foresight/tx-orchestrator";
import {
  createPublicClient,
  createWalletClient,
  decodeFunctionData,
  encodeFunctionData,
  erc20Abi,
  http,
  isAddressEqual,
  parseAbi,
  parseEther,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { gnosis } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { RedeemPlan } from "../plan";

/**
 * Needs a plain gnosis fork node (`yarn local-node:contracts:gnosis-fork`); `simulate-resolve`, which resolves the
 * sessions, reaches it only at 127.0.0.1:8545.
 */
const FORK_RPC_URL = process.env.FORK_RPC_URL;
const HARDHAT_FORK_URL = "http://127.0.0.1:8545";
const FORK_RPC_TIMEOUT_MS = 60_000;
const SETUP_TIMEOUT_MS = 900_000;
const RUN_TIMEOUT_MS = 600_000;
const CHAIN_ID = 100;
const REPO_ROOT = path.resolve(import.meta.dirname, "../../../../../../..");

const OWNER: Address = "0x1a00000000000000000000000000000000000c55";
const STRANGER: Address = "0x5700000000000000000000000000000000000c56";
const S_DAI: Address = "0xaf204776c7245bF4147c2612BF6e5972Ee483701";

const MARKET_ABI = parseAbi([
  "function conditionId() view returns (bytes32)",
  "function realityProxy() view returns (address)",
  "function wrappedOutcome(uint256 index) view returns (address wrapped1155, bytes data)",
]);
const REALITY_PROXY_ABI = parseAbi(["function conditionalTokens() view returns (address)"]);
const CONDITIONAL_TOKENS_ABI = parseAbi([
  "function payoutDenominator(bytes32 conditionId) view returns (uint256)",
  "function payoutNumerators(bytes32 conditionId, uint256 index) view returns (uint256)",
]);
const REDEEM_ABI = parseAbi([
  "function redeemPositions(address,address,uint256[],uint256[])",
  "function redeemConditionalToCollateral(address,address,uint256[],uint256[],uint256[])",
]);

const APPROVE = "0x095ea7b3";
const DOWN = 0;
const UP = 1;
const INVALID = 2;

/** The app's modules read validated env when they load, so they come in inside the tests. */
const load = async () => ({
  ...(await import("../../api/getTradeWalletRedeem")),
  ...(await import("../../oracle/allowlist")),
  ...(await import("@/config/contracts")),
  ...(await import("@/lib/trade-executor/executor")),
  ...(await import("@/lib/trade-executor/positions")),
});
type App = Awaited<ReturnType<typeof load>>;

async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const response = await fetch(FORK_RPC_URL!, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await response.json()) as { result: T; error?: { message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

const hex = (value: bigint) => `0x${value.toString(16)}`;
const same = (a: Address, b: Address) => isAddressEqual(a, b);
const floorPay = (amount: bigint, numerator: bigint, denominator: bigint) => (amount * numerator) / denominator;

interface ForkSession {
  sessionId: bigint;
  parentMarket: Address;
  childMarkets: Address[];
  /** wrappedOutcome(i) of the parent, options then INVALID. */
  parentTokens: Address[];
  /** [DOWN, UP, INVALID] per option. */
  childTokens: Address[][];
}

describe.skipIf(!FORK_RPC_URL)("a trade wallet redeem, against a gnosis fork", () => {
  let client: PublicClient;
  let wallet: WalletClient;
  let app: App;
  let snapshotId: string;
  let factory: Address;
  let tradeWallet: Address;
  let conditionalTokens: Address;
  /** Three options; 0 and 1 win, 2 loses. Child 0 resolves to 42 at setup; child 1 later, to 73. */
  let main: ForkSession;
  /** Two options; 0 wins with its child resolved INVALID, 1 loses. */
  let invalid: ForkSession;

  const read = <T>(args: Parameters<PublicClient["readContract"]>[0]) => client.readContract(args) as Promise<T>;
  const balanceOf = (token: Address, account: Address) =>
    read<bigint>({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account] });

  async function send(from: Address, to: Address, data: Hex, value = 0n) {
    const gas = ((await client.estimateGas({ account: from, to, data, value })) * 3n) / 2n;
    const hash = await wallet.sendTransaction({ account: from, chain: gnosis, to, data, value, gas });
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`transaction to ${to} reverted`);
    return receipt;
  }

  /** The owner signs the trade wallet's batch, as the page has the connected account do. */
  const sendPlan = (tx: FlowTx) => send(OWNER, tx.to, tx.data!, tx.value ?? 0n);

  const batch = (calls: { to: Address; data: Hex }[]) => {
    const tx = app.batchExecuteTx(tradeWallet, calls);
    return send(OWNER, tx.to, tx.data!);
  };

  async function wrapped(market: Address, index: number): Promise<Address> {
    const [token] = await read<readonly [Address, Hex]>({
      address: market,
      abi: MARKET_ABI,
      functionName: "wrappedOutcome",
      args: [BigInt(index)],
    });
    return token;
  }

  /** What ConditionalTokens holds for a market's condition, read here rather than through the app. */
  async function chainPayouts(market: Address, slots: number) {
    const conditionId = await read<Hex>({ address: market, abi: MARKET_ABI, functionName: "conditionId" });
    const payoutDenominator = await read<bigint>({
      address: conditionalTokens,
      abi: CONDITIONAL_TOKENS_ABI,
      functionName: "payoutDenominator",
      args: [conditionId],
    });
    const payoutNumerators: bigint[] = [];
    for (let index = 0; index < slots; index++) {
      payoutNumerators.push(
        await read<bigint>({
          address: conditionalTokens,
          abi: CONDITIONAL_TOKENS_ABI,
          functionName: "payoutNumerators",
          args: [conditionId, BigInt(index)],
        }),
      );
    }
    return { payoutNumerators, payoutDenominator };
  }

  async function deploySession(label: string, outcomes: string[]): Promise<ForkSession> {
    const openingTime = Number((await client.getBlock({ blockTag: "latest" })).timestamp) + 7 * 24 * 60 * 60;
    const sessionFactory = app.sessionFactoryAddress(CHAIN_ID)!;
    await send(
      OWNER,
      sessionFactory,
      encodeFunctionData({
        abi: app.sessionFactoryAbi,
        functionName: "deploySession",
        args: [
          {
            parent: {
              marketName: `Which options will the ${label} redeem fork test pick? (${Date.now()})`,
              outcomes,
              tokenNames: outcomes.map((_, index) => `RDM_${label}_${index}`),
              category: "misc",
              lang: "en",
              minBond: parseEther("1"),
              openingTime,
            },
            children: outcomes.map((name, index) => ({
              parentOutcomeIndex: BigInt(index),
              marketName: `What score will ${name} get?[%]`,
              outcomes: ["DOWN", "UP"],
              tokenNames: [`RDM_${label}_${index}_DOWN`, `RDM_${label}_${index}_UP`],
              lowerBound: 0n,
              upperBound: parseEther("100"),
              minBond: parseEther("1"),
              openingTime,
              category: "misc",
              lang: "en",
            })),
            multiCategoricalParent: true,
            metadataUri: `ipfs://redeem-fork-test-${label}`,
          },
        ],
      }),
    );
    const count = await read<bigint>({
      address: sessionFactory,
      abi: app.sessionFactoryAbi,
      functionName: "sessionCount",
    });
    const sessionId = count - 1n;
    const deployed = await read<{ parentMarket: Address; childMarkets: readonly Address[] }>({
      address: sessionFactory,
      abi: app.sessionFactoryAbi,
      functionName: "getSession",
      args: [sessionId],
    });
    const childMarkets = [...deployed.childMarkets];
    const parentTokens = await Promise.all(
      Array.from({ length: outcomes.length + 1 }, (_, index) => wrapped(deployed.parentMarket, index)),
    );
    const childTokens = await Promise.all(
      childMarkets.map((child) => Promise.all([DOWN, UP, INVALID].map((index) => wrapped(child, index)))),
    );
    return { sessionId, parentMarket: deployed.parentMarket, childMarkets, parentTokens, childTokens };
  }

  /** The trade wallet mints `parent` of each parent token, then `child[i]` of option i's child tokens from it. */
  async function mintPositions(session: ForkSession, parent: bigint, child: bigint[]) {
    const router = app.gnosisRouterAddress(CHAIN_ID)!;
    await batch([
      ...app.splitCalls({ router, collateral: S_DAI, market: session.parentMarket, amount: parent }),
      ...child.flatMap((amount, index) =>
        app.splitCalls({
          router,
          collateral: S_DAI,
          deposited: session.parentTokens[index]!,
          market: session.childMarkets[index]!,
          amount,
        }),
      ),
    ]);
  }

  /** Moves odd wei of `token` out of the trade wallet, so UP, DOWN and the parent tokens differ. */
  const strip = (token: Address, amount: bigint) => ({
    to: token,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [STRANGER, amount] }),
  });

  const resolve = (session: ForkSession, args: string[]) =>
    execFileSync("yarn", ["simulate:resolve:gnosis-fork", "--session", session.sessionId.toString(), ...args], {
      cwd: REPO_ROOT,
      stdio: "inherit",
      timeout: SETUP_TIMEOUT_MS,
    });

  const plan = (session: ForkSession): Promise<RedeemPlan> =>
    app.fetchTradeWalletRedeem(client, {
      chainId: CHAIN_ID,
      owner: OWNER,
      sessionFactory: factory,
      sessionId: session.sessionId,
    });

  /** The calls of a trade wallet batch. */
  function innerCalls(tx: FlowTx) {
    const outer = decodeFunctionData({ abi: app.tradeExecutorAbi, data: tx.data! });
    if (outer.functionName !== "batchExecute") throw new Error(`not a batchExecute: ${outer.functionName}`);
    return { calls: outer.args[0] as readonly { to: Address; data: Hex }[] };
  }

  /** The plan's calls that belong to one market's part: its redeem and the approves of that market's tokens. */
  function partCalls(tx: FlowTx, market: Address, tokens: Address[]) {
    return innerCalls(tx).calls.filter(({ to, data }) => {
      if (tokens.some((token) => same(token, to))) return true;
      if (data.startsWith(APPROVE)) return false;
      const decoded = decodeFunctionData({ abi: REDEEM_ABI, data });
      return same(decoded.args[1] as Address, market);
    });
  }

  /** What `tokens` the trade wallet holds, in order. */
  const holdings = (tokens: Address[]) => Promise.all(tokens.map((token) => balanceOf(token, tradeWallet)));

  /** Runs `body` and puts the chain back as it was. */
  async function inSnapshot<T>(body: () => Promise<T>): Promise<T> {
    const id = await rpc<string>("evm_snapshot");
    try {
      return await body();
    } finally {
      await rpc("evm_revert", [id]);
    }
  }

  beforeAll(async () => {
    if (new URL(FORK_RPC_URL!).origin !== new URL(HARDHAT_FORK_URL).origin) {
      throw new Error(`simulate-resolve reaches the fork at ${HARDHAT_FORK_URL}; FORK_RPC_URL is ${FORK_RPC_URL}`);
    }
    const transport = http(FORK_RPC_URL, { timeout: FORK_RPC_TIMEOUT_MS });
    client = createPublicClient({ chain: gnosis, transport, pollingInterval: 100 }) as PublicClient;
    wallet = createWalletClient({ chain: gnosis, transport, pollingInterval: 100 });
    app = await load();
    factory = app.sessionFactoryAddress(CHAIN_ID)!;
    const executorFactory = app.tradeExecutorFactoryAddress(CHAIN_ID);
    const route = app.sDaiDepositRoute(S_DAI, CHAIN_ID);
    if (!factory || !executorFactory || !route) throw new Error("This chain is missing a deployment the test needs.");

    snapshotId = await rpc<string>("evm_snapshot");
    for (const account of [OWNER, STRANGER]) {
      await rpc("hardhat_impersonateAccount", [account]);
      await rpc("hardhat_setBalance", [account, hex(parseEther("10000"))]);
    }

    tradeWallet = app.executorAddress(executorFactory, OWNER);
    const createTx = app.createExecutorTx(executorFactory);
    await send(OWNER, createTx.to, createTx.data!);
    await send(
      OWNER,
      route.sDaiAdapter,
      encodeFunctionData({ abi: app.sDaiAdapterAbi, functionName: "depositXDAI", args: [tradeWallet] }),
      parseEther("100"),
    );

    main = await deploySession("main", ["Option A", "Option B", "Option C"]);
    invalid = await deploySession("invalid", ["Option A", "Option B"]);
    const proxy = await read<Address>({ address: main.parentMarket, abi: MARKET_ABI, functionName: "realityProxy" });
    conditionalTokens = await read<Address>({
      address: proxy,
      abi: REALITY_PROXY_ABI,
      functionName: "conditionalTokens",
    });

    await mintPositions(main, parseEther("9"), [parseEther("4"), parseEther("3"), parseEther("2")]);
    await batch([
      strip(main.childTokens[0]![DOWN]!, 1_234_567_891n),
      strip(main.childTokens[1]![UP]!, 987_654_321n),
      strip(main.parentTokens[1]!, 3n),
    ]);
    await mintPositions(invalid, parseEther("5"), [parseEther("2"), parseEther("1")]);
    await batch([strip(invalid.childTokens[0]![INVALID]!, 17n), strip(invalid.parentTokens[0]!, 7n)]);

    resolve(main, ["--winners", "0,1", "--children", "0=42"]);
    resolve(invalid, ["--winners", "0", "--children", "0=invalid"]);
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    if (!snapshotId) return;
    const head = BigInt(await rpc<string>("eth_blockNumber"));
    await rpc("evm_revert", [snapshotId]);
    // the indexer reads a rewound height as a reorg; mining past the highest height lets it settle
    const rewound = BigInt(await rpc<string>("eth_blockNumber"));
    if (rewound <= head) await rpc("hardhat_mine", [hex(head - rewound + 1n)]);
  });

  /** The parent part's payout from the chain's numerators and the trade wallet's balances. */
  async function parentPayout(session: ForkSession, options: number) {
    const { payoutNumerators, payoutDenominator } = await chainPayouts(session.parentMarket, options + 1);
    const balances = await holdings(session.parentTokens);
    return balances.reduce(
      (sum, balance, index) => sum + floorPay(balance, payoutNumerators[index]!, payoutDenominator),
      0n,
    );
  }

  /** A child part's payout: each child token floored into parent outcome tokens, then the parent fraction floored. */
  async function childPayout(session: ForkSession, options: number, index: number) {
    const parent = await chainPayouts(session.parentMarket, options + 1);
    const child = await chainPayouts(session.childMarkets[index]!, 3);
    const balances = await holdings(session.childTokens[index]!);
    const outcomeTokens = balances.reduce(
      (sum, balance, slot) => sum + floorPay(balance, child.payoutNumerators[slot]!, child.payoutDenominator),
      0n,
    );
    return floorPay(outcomeTokens, parent.payoutNumerators[index]!, parent.payoutDenominator);
  }

  it(
    "A2 with child 1 unresolved plans both winners' parent tokens and child 0, and lists option 1 as waiting",
    async () => {
      expect((await chainPayouts(main.childMarkets[1]!, 3)).payoutDenominator).toBe(0n);

      const redeem = await plan(main);

      expect(redeem.waiting).toContain(1);
      expect(redeem.waiting).not.toContain(0);
      expect(redeem.waiting).not.toContain(2);
      const markets = redeem.parts.map((part) => part.market.toLowerCase()).sort();
      expect(markets).toEqual([main.parentMarket, main.childMarkets[0]!].map((each) => each.toLowerCase()).sort());
      expect(redeem.tx).not.toBeNull();
      expect(same(redeem.tx!.to, tradeWallet)).toBe(true);
      expect(partCalls(redeem.tx!, main.childMarkets[1]!, main.childTokens[1]!)).toEqual([]);
      expect(partCalls(redeem.tx!, main.childMarkets[2]!, main.childTokens[2]!)).toEqual([]);

      const { calls } = innerCalls(redeem.tx!);
      const list = app.REDEEM_ALLOW_LIST[CHAIN_ID]!;
      const redeems = calls.filter(({ data }) => !data.startsWith(APPROVE));
      expect(redeems.length).toBeGreaterThanOrEqual(2);
      for (const { to, data } of calls) {
        if (data.startsWith(APPROVE)) {
          const { args } = decodeFunctionData({ abi: erc20Abi, data });
          expect([list.gnosisRouter, list.conditionalRouter].some((router) => same(router, args![0] as Address))).toBe(
            true,
          );
          continue;
        }
        const decoded = decodeFunctionData({ abi: REDEEM_ABI, data });
        expect(same(decoded.args[0] as Address, S_DAI)).toBe(true);
        if (decoded.functionName === "redeemPositions") {
          expect(same(to, list.gnosisRouter)).toBe(true);
          expect(same(decoded.args[1] as Address, main.parentMarket)).toBe(true);
        } else {
          expect(same(to, list.conditionalRouter)).toBe(true);
          expect(same(decoded.args[1] as Address, main.childMarkets[0]!)).toBe(true);
          expect(decoded.args[3]).toEqual([0n]);
        }
      }
    },
    RUN_TIMEOUT_MS,
  );

  it(
    "A4 and A8 show a parent part's and a child part's payout equal to the trade wallet's sDAI change, to the wei",
    async () => {
      const redeem = await plan(main);
      const parentPart = redeem.parts.find((part) => same(part.market, main.parentMarket))!;
      const childPart = redeem.parts.find((part) => same(part.market, main.childMarkets[0]!))!;

      expect(parentPart.payout).toBe(await parentPayout(main, 3));
      expect(childPart.payout).toBe(await childPayout(main, 3, 0));

      for (const [part, market, tokens] of [
        [parentPart, main.parentMarket, main.parentTokens],
        [childPart, main.childMarkets[0]!, main.childTokens[0]!],
      ] as const) {
        const change = await inSnapshot(async () => {
          const before = await balanceOf(S_DAI, tradeWallet);
          await batch(partCalls(redeem.tx!, market, [...tokens]));
          return (await balanceOf(S_DAI, tradeWallet)) - before;
        });
        expect(change).toBe(part.payout);
      }

      const total = await inSnapshot(async () => {
        const before = await balanceOf(S_DAI, tradeWallet);
        await sendPlan(redeem.tx!);
        return (await balanceOf(S_DAI, tradeWallet)) - before;
      });
      expect(total).toBe(redeem.payout);
      expect(redeem.payout).toBe(parentPart.payout + childPart.payout);
    },
    RUN_TIMEOUT_MS,
  );

  it(
    "A1 and A5 after both winners resolve, one run raises the trade wallet's sDAI by the payout and leaves nothing",
    async () => {
      resolve(main, ["--children", "1=73"]);
      const redeem = await plan(main);
      const expected =
        (await parentPayout(main, 3)) + (await childPayout(main, 3, 0)) + (await childPayout(main, 3, 1));

      expect(redeem.waiting).toEqual([]);
      expect(redeem.payout).toBe(expected);
      expect(redeem.payout).toBeGreaterThan(0n);

      const redeemedTokens = [
        main.parentTokens[0]!,
        main.parentTokens[1]!,
        main.childTokens[0]![DOWN]!,
        main.childTokens[0]![UP]!,
        main.childTokens[1]![DOWN]!,
        main.childTokens[1]![UP]!,
      ];
      const keptTokens = [
        main.parentTokens[2]!,
        main.parentTokens[3]!,
        main.childTokens[0]![INVALID]!,
        main.childTokens[1]![INVALID]!,
        ...main.childTokens[2]!,
      ];
      const keptBefore = await holdings(keptTokens);
      expect((await holdings(redeemedTokens)).every((each) => each > 0n)).toBe(true);
      const sDaiBefore = await balanceOf(S_DAI, tradeWallet);
      const ownerBefore = await balanceOf(S_DAI, OWNER);

      await sendPlan(redeem.tx!);

      expect((await balanceOf(S_DAI, tradeWallet)) - sDaiBefore).toBe(redeem.payout);
      expect(await balanceOf(S_DAI, OWNER)).toBe(ownerBefore);
      expect(await holdings(redeemedTokens)).toEqual(redeemedTokens.map(() => 0n));
      expect(await holdings(keptTokens)).toEqual(keptBefore);

      const again = await plan(main);
      expect(again.parts).toEqual([]);
      expect(again.payout).toBe(0n);
      expect(again.tx).toBeNull();
    },
    RUN_TIMEOUT_MS,
  );

  it(
    "A7 redeems a child's INVALID balance once that child resolved INVALID and its parent outcome pays",
    async () => {
      expect((await chainPayouts(invalid.childMarkets[0]!, 3)).payoutNumerators).toEqual([0n, 0n, 1n]);
      const redeem = await plan(invalid);
      const childPart = redeem.parts.find((part) => same(part.market, invalid.childMarkets[0]!))!;

      expect(childPart.payout).toBe(await childPayout(invalid, 2, 0));
      expect(redeem.payout).toBe((await parentPayout(invalid, 2)) + childPart.payout);
      const childCalls = partCalls(redeem.tx!, invalid.childMarkets[0]!, invalid.childTokens[0]!);
      const redeemCall = childCalls.find(({ data }) => !data.startsWith(APPROVE))!;
      const decoded = decodeFunctionData({ abi: REDEEM_ABI, data: redeemCall.data });
      expect(decoded.functionName).toBe("redeemConditionalToCollateral");
      expect(decoded.args[2]).toEqual([2n]);
      expect(decoded.args[4]).toEqual([await balanceOf(invalid.childTokens[0]![INVALID]!, tradeWallet)]);

      const upDownBefore = await holdings([invalid.childTokens[0]![DOWN]!, invalid.childTokens[0]![UP]!]);
      const sDaiBefore = await balanceOf(S_DAI, tradeWallet);

      await sendPlan(redeem.tx!);

      expect((await balanceOf(S_DAI, tradeWallet)) - sDaiBefore).toBe(redeem.payout);
      expect(await balanceOf(invalid.childTokens[0]![INVALID]!, tradeWallet)).toBe(0n);
      expect(await holdings([invalid.childTokens[0]![DOWN]!, invalid.childTokens[0]![UP]!])).toEqual(upDownBefore);
      expect((await plan(invalid)).tx).toBeNull();
    },
    RUN_TIMEOUT_MS,
  );
});
