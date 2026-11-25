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
  parseAbi,
  parseEther,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { gnosis } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The Redeem popup's money paths against a real chain (spec D11, D12; oracle R3, R5): a plain gnosis fork node
 * (`yarn local-node:contracts:gnosis-fork`), then `apps/web/scripts/test-fork-redeem.sh`. One session, two owners,
 * each with a trade wallet holding parent and child tokens; the first owner's own wallet holds tokens too.
 *
 * The API it holds the app to, beside the reads and planners the earlier redeem suites name:
 *
 *   readTradeWalletRedeemToOwner(client, { chainId, owner, sessionFactory, sessionId })
 *     features/resolution/api/getTradeWalletRedeemToOwner.ts → { plan, scope, payout: { owner, resolution } }
 *     The ticked batch: the unticked one, then one sDAI transfer of the payout to the trade wallet's owner().
 *   ownerPayBatchDepartures({ tx, chainId, account, scope, payout }) → string[]
 *     features/resolution/redeem/payOwner.ts; empty when the ticked batch keeps to oracle R2 to R5.
 */
const FORK_RPC_URL = process.env.FORK_RPC_URL;
const HARDHAT_FORK_URL = "http://127.0.0.1:8545";
const FORK_RPC_TIMEOUT_MS = 60_000;
const SETUP_TIMEOUT_MS = 900_000;
const RUN_TIMEOUT_MS = 600_000;
const CHAIN_ID = 100;
const REPO_ROOT = path.resolve(import.meta.dirname, "../../../../../../..");

const OWNER_A: Address = "0x1a00000000000000000000000000000000000c61";
const OWNER_B: Address = "0x1a00000000000000000000000000000000000c62";
const STRANGER: Address = "0x5700000000000000000000000000000000000c63";
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
const TRADE_WALLET_ABI = parseAbi(["function owner() view returns (address)"]);

const DOWN = 0;
const UP = 1;
const INVALID = 2;
const OPTIONS = 3;

/** The app's modules read validated env when they load, so they come in inside the tests. */
const load = async () => ({
  ...(await import("../../api/getTradeWalletRedeem")),
  ...(await import("../../api/getTradeWalletRedeemToOwner")),
  ...(await import("../../api/getWalletRedeem")),
  ...(await import("../plan")),
  ...(await import("../payOwner")),
  ...(await import("../tradeWalletBatchAllowed")),
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
const floorPay = (amount: bigint, numerator: bigint, denominator: bigint) => (amount * numerator) / denominator;

describe.skipIf(!FORK_RPC_URL)("the Redeem popup's redeems, against a gnosis fork", () => {
  let client: PublicClient;
  let wallet: WalletClient;
  let app: App;
  let snapshotId: string;
  let factory: Address;
  let router: Address;
  let conditionalTokens: Address;
  let sessionId: bigint;
  let parentMarket: Address;
  let childMarkets: Address[];
  /** wrappedOutcome(i) of the parent: options then INVALID. */
  let parentTokens: Address[];
  /** [DOWN, UP, INVALID] per option. */
  let childTokens: Address[][];
  const tradeWallets = new Map<Address, Address>();

  const read = <T>(args: Parameters<PublicClient["readContract"]>[0]) => client.readContract(args) as Promise<T>;
  const balanceOf = (token: Address, account: Address) =>
    read<bigint>({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account] });
  const holdings = (tokens: Address[], account: Address) =>
    Promise.all(tokens.map((token) => balanceOf(token, account)));
  const tradeWalletOf = (owner: Address) => tradeWallets.get(owner)!;

  async function send(from: Address, to: Address, data: Hex, value = 0n) {
    const gas = ((await client.estimateGas({ account: from, to, data, value })) * 3n) / 2n;
    const hash = await wallet.sendTransaction({ account: from, chain: gnosis, to, data, value, gas });
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`transaction to ${to} reverted`);
    return receipt;
  }

  const sendTx = (from: Address, tx: FlowTx) => send(from, tx.to, tx.data!, tx.value ?? 0n);
  const batch = (owner: Address, calls: { to: Address; data: Hex }[]) =>
    sendTx(owner, app.batchExecuteTx(tradeWalletOf(owner), calls));
  const transfer = (token: Address, to: Address, amount: bigint) => ({
    to: token,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] }),
  });

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

  /** Oracle R5 for `holder`, from the chain's numerators and its balances: parent floored once, children twice. */
  async function expectedPayout(holder: Address) {
    const parent = await chainPayouts(parentMarket, OPTIONS + 1);
    const parentBalances = await holdings(parentTokens, holder);
    let total = parentBalances.reduce(
      (sum, balance, index) => sum + floorPay(balance, parent.payoutNumerators[index]!, parent.payoutDenominator),
      0n,
    );
    for (let option = 0; option < OPTIONS; option++) {
      if (parent.payoutNumerators[option] === 0n) continue;
      const child = await chainPayouts(childMarkets[option]!, 3);
      if (child.payoutDenominator === 0n) continue;
      const balances = await holdings(childTokens[option]!, holder);
      const outcomeTokens = balances.reduce(
        (sum, balance, slot) => sum + floorPay(balance, child.payoutNumerators[slot]!, child.payoutDenominator),
        0n,
      );
      total += floorPay(outcomeTokens, parent.payoutNumerators[option]!, parent.payoutDenominator);
    }
    return total;
  }

  /** The tokens that pay at this resolution: winners' parent tokens and their children's UP and DOWN. */
  const payingTokens = () => [
    parentTokens[0]!,
    parentTokens[1]!,
    childTokens[0]![DOWN]!,
    childTokens[0]![UP]!,
    childTokens[1]![DOWN]!,
    childTokens[1]![UP]!,
  ];

  const request = (owner: Address) => ({ chainId: CHAIN_ID, owner, sessionFactory: factory, sessionId });

  /** Runs `body` and puts the chain back as it was. */
  async function inSnapshot<T>(body: () => Promise<T>): Promise<T> {
    const id = await rpc<string>("evm_snapshot");
    try {
      return await body();
    } finally {
      await rpc("evm_revert", [id]);
    }
  }

  function innerCalls(tx: FlowTx) {
    const outer = decodeFunctionData({ abi: app.tradeExecutorAbi, data: tx.data! });
    if (outer.functionName !== "batchExecute") throw new Error(`not a batchExecute: ${outer.functionName}`);
    return outer.args[0].map(({ to, data }) => ({ to, data }));
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
    router = app.gnosisRouterAddress(CHAIN_ID)!;
    const executorFactory = app.tradeExecutorFactoryAddress(CHAIN_ID);
    const route = app.sDaiDepositRoute(S_DAI, CHAIN_ID);
    if (!factory || !router || !executorFactory || !route) {
      throw new Error("This chain is missing a deployment the test needs.");
    }

    snapshotId = await rpc<string>("evm_snapshot");
    for (const account of [OWNER_A, OWNER_B, STRANGER]) {
      await rpc("hardhat_impersonateAccount", [account]);
      await rpc("hardhat_setBalance", [account, hex(parseEther("10000"))]);
    }
    for (const owner of [OWNER_A, OWNER_B]) {
      tradeWallets.set(owner, app.executorAddress(executorFactory, owner));
      const createTx = app.createExecutorTx(executorFactory);
      await send(owner, createTx.to, createTx.data!);
      for (const holder of [tradeWalletOf(owner), owner]) {
        await send(
          owner,
          route.sDaiAdapter,
          encodeFunctionData({ abi: app.sDaiAdapterAbi, functionName: "depositXDAI", args: [holder] }),
          parseEther("100"),
        );
      }
    }

    const outcomes = ["Option A", "Option B", "Option C"];
    const openingTime = Number((await client.getBlock({ blockTag: "latest" })).timestamp) + 7 * 24 * 60 * 60;
    await send(
      OWNER_A,
      factory,
      encodeFunctionData({
        abi: app.sessionFactoryAbi,
        functionName: "deploySession",
        args: [
          {
            parent: {
              marketName: `Which options will the redeem popup fork test pick? (${Date.now()})`,
              outcomes,
              tokenNames: outcomes.map((_, index) => `PRDM_${index}`),
              category: "misc",
              lang: "en",
              minBond: parseEther("1"),
              openingTime,
            },
            children: outcomes.map((name, index) => ({
              parentOutcomeIndex: BigInt(index),
              marketName: `What score will ${name} get?[%]`,
              outcomes: ["DOWN", "UP"],
              tokenNames: [`PRDM_${index}_DOWN`, `PRDM_${index}_UP`],
              lowerBound: 0n,
              upperBound: parseEther("100"),
              minBond: parseEther("1"),
              openingTime,
              category: "misc",
              lang: "en",
            })),
            multiCategoricalParent: true,
            metadataUri: "ipfs://redeem-popup-fork-test",
          },
        ],
      }),
    );
    sessionId =
      (await read<bigint>({ address: factory, abi: app.sessionFactoryAbi, functionName: "sessionCount" })) - 1n;
    const deployed = await read<{ parentMarket: Address; childMarkets: readonly Address[] }>({
      address: factory,
      abi: app.sessionFactoryAbi,
      functionName: "getSession",
      args: [sessionId],
    });
    parentMarket = deployed.parentMarket;
    childMarkets = [...deployed.childMarkets];
    parentTokens = await Promise.all(Array.from({ length: OPTIONS + 1 }, (_, index) => wrapped(parentMarket, index)));
    childTokens = await Promise.all(
      childMarkets.map((child) => Promise.all([DOWN, UP, INVALID].map((index) => wrapped(child, index)))),
    );
    const proxy = await read<Address>({ address: parentMarket, abi: MARKET_ABI, functionName: "realityProxy" });
    conditionalTokens = await read<Address>({
      address: proxy,
      abi: REALITY_PROXY_ABI,
      functionName: "conditionalTokens",
    });

    const splits = (amounts: { parent: bigint; child: bigint[] }) => [
      ...app.splitCalls({ router, collateral: S_DAI, market: parentMarket, amount: amounts.parent }),
      ...amounts.child.flatMap((amount, index) =>
        app.splitCalls({
          router,
          collateral: S_DAI,
          deposited: parentTokens[index]!,
          market: childMarkets[index]!,
          amount,
        }),
      ),
    ];
    await batch(
      OWNER_A,
      splits({ parent: parseEther("9"), child: [parseEther("4"), parseEther("3"), parseEther("2")] }),
    );
    await batch(OWNER_A, [
      transfer(childTokens[0]![DOWN]!, STRANGER, 1_234_567_891n),
      transfer(parentTokens[1]!, STRANGER, 3n),
    ]);
    await batch(OWNER_B, splits({ parent: parseEther("5"), child: [parseEther("2") + 7n, parseEther("1")] }));
    // the first owner's own wallet holds tokens too, split from the wallet itself
    for (const { to, data } of splits({ parent: parseEther("6"), child: [parseEther("2") + 11n, parseEther("1")] })) {
      await send(OWNER_A, to, data);
    }

    execFileSync(
      "yarn",
      [
        "simulate:resolve:gnosis-fork",
        "--session",
        sessionId.toString(),
        "--winners",
        "0,1",
        "--children",
        "0=42,1=73",
      ],
      { cwd: REPO_ROOT, stdio: "inherit", timeout: SETUP_TIMEOUT_MS },
    );
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    if (!snapshotId) return;
    const head = BigInt(await rpc<string>("eth_blockNumber"));
    await rpc("evm_revert", [snapshotId]);
    // the indexer reads a rewound height as a reorg; mining past the highest height lets it settle
    const rewound = BigInt(await rpc<string>("eth_blockNumber"));
    if (rewound <= head) await rpc("hardhat_mine", [hex(head - rewound + 1n)]);
  });

  it(
    "A3 one Redeem empties both wallets' paying tokens and moves each wallet's sDAI by its own payout",
    async () => {
      await inSnapshot(async () => {
        const tradeWallet = tradeWalletOf(OWNER_A);
        const { plan: tradePlan, scope } = await app.readTradeWalletRedeem(client, request(OWNER_A));
        const walletPlan = app.planWalletRedeem(await app.fetchWalletRedeemInput(client, request(OWNER_A)));
        const tradeExpected = await expectedPayout(tradeWallet);
        const walletExpected = await expectedPayout(OWNER_A);

        expect(tradePlan.payout).toBe(tradeExpected);
        expect(walletPlan.payout).toBe(walletExpected);
        expect(tradeExpected).toBeGreaterThan(0n);
        expect(walletExpected).toBeGreaterThan(0n);
        expect(app.redeemBatchDepartures({ tx: tradePlan.tx!, chainId: CHAIN_ID, account: OWNER_A, scope })).toEqual(
          [],
        );
        expect(app.redeemCallsDepartures({ calls: walletPlan.calls, chainId: CHAIN_ID, scope })).toEqual([]);
        expect((await holdings(payingTokens(), tradeWallet)).every((each) => each > 0n)).toBe(true);
        expect((await holdings(payingTokens(), OWNER_A)).every((each) => each > 0n)).toBe(true);
        const tradeBefore = await balanceOf(S_DAI, tradeWallet);
        const walletBefore = await balanceOf(S_DAI, OWNER_A);

        await sendTx(OWNER_A, tradePlan.tx!);
        for (const call of walletPlan.calls) await sendTx(OWNER_A, call);

        expect((await balanceOf(S_DAI, tradeWallet)) - tradeBefore).toBe(tradeExpected);
        expect((await balanceOf(S_DAI, OWNER_A)) - walletBefore).toBe(walletExpected);
        expect(await holdings(payingTokens(), tradeWallet)).toEqual(payingTokens().map(() => 0n));
        expect(await holdings(payingTokens(), OWNER_A)).toEqual(payingTokens().map(() => 0n));
      });
    },
    RUN_TIMEOUT_MS,
  );

  it(
    "A4 unticked, the trade wallet receives the payout and its owner's sDAI does not move",
    async () => {
      await inSnapshot(async () => {
        const tradeWallet = tradeWalletOf(OWNER_A);
        const plan = await app.fetchTradeWalletRedeem(client, request(OWNER_A));
        const expected = await expectedPayout(tradeWallet);
        expect(innerCalls(plan.tx!).some(({ data }) => data.startsWith("0xa9059cbb"))).toBe(false);
        const tradeBefore = await balanceOf(S_DAI, tradeWallet);
        const ownerBefore = await balanceOf(S_DAI, OWNER_A);

        await sendTx(OWNER_A, plan.tx!);

        expect((await balanceOf(S_DAI, tradeWallet)) - tradeBefore).toBe(expected);
        expect(await balanceOf(S_DAI, OWNER_A)).toBe(ownerBefore);
      });
    },
    RUN_TIMEOUT_MS,
  );

  it(
    "A5 and A8 ticked, each owner's sDAI rises by exactly the payout and the trade wallet keeps the sDAI it had",
    async () => {
      for (const owner of [OWNER_A, OWNER_B]) {
        await inSnapshot(async () => {
          const tradeWallet = tradeWalletOf(owner);
          const onchainOwner = await read<Address>({
            address: tradeWallet,
            abi: TRADE_WALLET_ABI,
            functionName: "owner",
          });
          const { plan, scope, payout } = await app.readTradeWalletRedeemToOwner(client, request(owner));
          const expected = await expectedPayout(tradeWallet);

          expect(payout.owner.toLowerCase()).toBe(onchainOwner.toLowerCase());
          expect(plan.payout).toBe(expected);
          expect(
            app.ownerPayBatchDepartures({ tx: plan.tx!, chainId: CHAIN_ID, account: owner, scope, payout }),
          ).toEqual([]);
          const prior = await balanceOf(S_DAI, tradeWallet);
          expect(prior).toBeGreaterThan(0n);
          const ownerBefore = await balanceOf(S_DAI, owner);

          await sendTx(owner, plan.tx!);

          expect((await balanceOf(S_DAI, owner)) - ownerBefore).toBe(expected);
          expect(await balanceOf(S_DAI, tradeWallet)).toBe(prior);
          expect(await holdings(payingTokens().slice(0, 4), tradeWallet)).toEqual([0n, 0n, 0n, 0n]);
        });
      }
    },
    RUN_TIMEOUT_MS,
  );

  it(
    "A8 a transfer above what the redeem pays reverts the whole batch, leaving tokens and balances as they were",
    async () => {
      await inSnapshot(async () => {
        const tradeWallet = tradeWalletOf(OWNER_A);
        await batch(OWNER_A, [transfer(S_DAI, STRANGER, await balanceOf(S_DAI, tradeWallet))]);
        expect(await balanceOf(S_DAI, tradeWallet)).toBe(0n);

        const { plan, scope, payout } = await app.readTradeWalletRedeemToOwner(client, request(OWNER_A));
        const calls = innerCalls(plan.tx!);
        const short = app.batchExecuteTx(tradeWallet, [
          ...calls.slice(0, -1),
          transfer(S_DAI, OWNER_A, plan.payout + 1n),
        ]);
        expect(
          app.ownerPayBatchDepartures({ tx: short, chainId: CHAIN_ID, account: OWNER_A, scope, payout }),
        ).not.toEqual([]);

        const tokens = [...parentTokens, ...childTokens.flat()];
        const tokensBefore = await holdings(tokens, tradeWallet);
        const ownerBefore = await balanceOf(S_DAI, OWNER_A);

        await expect(sendTx(OWNER_A, short)).rejects.toThrow();

        expect(await holdings(tokens, tradeWallet)).toEqual(tokensBefore);
        expect(await balanceOf(S_DAI, tradeWallet)).toBe(0n);
        expect(await balanceOf(S_DAI, OWNER_A)).toBe(ownerBefore);
      });
    },
    RUN_TIMEOUT_MS,
  );
});
