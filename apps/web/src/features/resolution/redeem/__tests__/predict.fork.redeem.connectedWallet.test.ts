// @vitest-environment node
import { execFileSync } from "node:child_process";
import path from "node:path";

import { createFlowRunStore, createMemoryStorage, createViemTxGateway } from "@foresight/tx-orchestrator";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  http,
  parseAbi,
  parseEther,
  parseEventLogs,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { gnosis } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * A connected wallet redeem against a real chain: a plain gnosis fork node (`yarn local-node:contracts:gnosis-fork`),
 * then `yarn workspace web test:fork` or `apps/web/scripts/test-fork-redeem.sh`. The test deploys a session, adds
 * liquidity from the wallet on Swapr, resolves the parent and one winner's child with the contracts package's
 * `simulate-resolve` task, removes the liquidity, and redeems what the wallet got back.
 *
 * The API it holds the app to:
 *
 *   fetchWalletRedeemInput(client: PublicClient, request: {        features/resolution/api/getWalletRedeem.ts
 *     chainId: number; owner: Address; sessionFactory: Address; sessionId: bigint;
 *   }) → Promise<WalletRedeemInput>
 *     The session's resolution, its markets' wrappedOutcome tokens and the connected account's own balances,
 *     read on-chain: the input `planWalletRedeem` (features/resolution/redeem/plan.ts) plans from.
 *   planWalletRedeem(input) → { parts; waiting: number[]; payout: bigint; calls: FlowTx[] }
 *   createRedeemRun({ gateway, wallet, reader, store, flowId, account, chainId, request, pollMs })
 *     features/resolution/redeem/run.ts; reader: { nextNonce, hasPending, blockNumber, sentWithNonce, balanceOf }.
 */
const FORK_RPC_URL = process.env.FORK_RPC_URL;
const HARDHAT_FORK_URL = "http://127.0.0.1:8545";
const FORK_RPC_TIMEOUT_MS = 60_000;
const SETUP_TIMEOUT_MS = 900_000;
const RUN_TIMEOUT_MS = 600_000;
const CHAIN_ID = 100;
const REPO_ROOT = path.resolve(import.meta.dirname, "../../../../../../..");

const OWNER: Address = "0x1a00000000000000000000000000000000000c57";
const S_DAI: Address = "0xaf204776c7245bF4147c2612BF6e5972Ee483701";
const Q96 = 2n ** 96n;
const MAX_UINT128 = 2n ** 128n - 1n;

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
const NFPM_ABI = parseAbi([
  "function createAndInitializePoolIfNecessary(address token0, address token1, uint160 sqrtPriceX96) payable returns (address pool)",
  "function mint((address token0, address token1, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
  "function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
  "function decreaseLiquidity((uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline) params) payable returns (uint256 amount0, uint256 amount1)",
  "function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max) params) payable returns (uint256 amount0, uint256 amount1)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]);
const FACTORY_ABI = parseAbi(["function poolByPair(address tokenA, address tokenB) view returns (address)"]);
const POOL_ABI = parseAbi(["function tickSpacing() view returns (int24)"]);
/** Swapr's Algebra NonfungiblePositionManager on Gnosis, and the factory its pools come from. */
const POSITION_MANAGER: Address = "0x91fD594c46D8B01E62dBDeBed2401dde01817834";
const ALGEBRA_FACTORY: Address = "0xA0864cCA6E114013AB0e27cbd5B6f4c8947da766";

const DOWN = 0;
const UP = 1;
const INVALID = 2;

/** The app's modules read validated env when they load, so they come in inside the tests. */
const load = async () => ({
  ...(await import("../../api/getWalletRedeem")),
  ...(await import("../plan")),
  ...(await import("../run")),
  ...(await import("@/config/contracts")),
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
const sortPair = (a: Address, b: Address): [Address, Address] => (BigInt(a) < BigInt(b) ? [a, b] : [b, a]);

describe.skipIf(!FORK_RPC_URL)("a connected wallet redeem after Remove, against a gnosis fork", () => {
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

  const read = <T>(args: Parameters<PublicClient["readContract"]>[0]) => client.readContract(args) as Promise<T>;
  const balanceOf = (token: Address, account: Address = OWNER) =>
    read<bigint>({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account] });
  const holdings = (tokens: Address[]) => Promise.all(tokens.map((token) => balanceOf(token)));

  async function send(to: Address, data: Hex, value = 0n) {
    const gas = ((await client.estimateGas({ account: OWNER, to, data, value })) * 3n) / 2n;
    const hash = await wallet.sendTransaction({ account: OWNER, chain: gnosis, to, data, value, gas });
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`setup transaction to ${to} reverted`);
    return receipt;
  }

  const approve = (token: Address, spender: Address, amount: bigint) =>
    send(token, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }));

  async function wrapped(market: Address, index: number): Promise<Address> {
    const [token] = await read<readonly [Address, Hex]>({
      address: market,
      abi: MARKET_ABI,
      functionName: "wrappedOutcome",
      args: [BigInt(index)],
    });
    return token;
  }

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

  const split = async (collateralIn: Address, market: Address, amount: bigint) => {
    await approve(collateralIn, router, amount);
    await send(
      router,
      encodeFunctionData({ abi: app.gnosisRouterAbi, functionName: "splitPosition", args: [S_DAI, market, amount] }),
    );
  };

  const deadline = async () => (await client.getBlock({ blockTag: "latest" })).timestamp + 3_600n;

  /** A full-range position in the pool of `a` and `b`, created at price 1, from the wallet; its token id. */
  async function addLiquidity(a: Address, b: Address, amount: bigint): Promise<bigint> {
    const list = { positionManager: POSITION_MANAGER, algebraFactory: ALGEBRA_FACTORY };
    const [token0, token1] = sortPair(a, b);
    await send(
      list.positionManager,
      encodeFunctionData({
        abi: NFPM_ABI,
        functionName: "createAndInitializePoolIfNecessary",
        args: [token0, token1, Q96],
      }),
    );
    const pool = await read<Address>({
      address: list.algebraFactory,
      abi: FACTORY_ABI,
      functionName: "poolByPair",
      args: [token0, token1],
    });
    const spacing = await read<number>({ address: pool, abi: POOL_ABI, functionName: "tickSpacing" });
    const tick = 887272 - (887272 % spacing);
    await approve(token0, list.positionManager, amount);
    await approve(token1, list.positionManager, amount);
    const receipt = await send(
      list.positionManager,
      encodeFunctionData({
        abi: NFPM_ABI,
        functionName: "mint",
        args: [
          {
            token0,
            token1,
            tickLower: -tick,
            tickUpper: tick,
            amount0Desired: amount,
            amount1Desired: amount,
            amount0Min: 0n,
            amount1Min: 0n,
            recipient: OWNER,
            deadline: await deadline(),
          },
        ],
      }),
    );
    const minted = parseEventLogs({ abi: NFPM_ABI, logs: receipt.logs, eventName: "Transfer" }).find(
      (log) => log.args.from === zeroAddress,
    );
    if (!minted) throw new Error("the mint gave out no position");
    return minted.args.tokenId;
  }

  /** Takes all of position `tokenId` out, back to the wallet. */
  async function removeLiquidity(tokenId: bigint) {
    const list = { positionManager: POSITION_MANAGER };
    const position = await read<readonly unknown[]>({
      address: list.positionManager,
      abi: NFPM_ABI,
      functionName: "positions",
      args: [tokenId],
    });
    await send(
      list.positionManager,
      encodeFunctionData({
        abi: NFPM_ABI,
        functionName: "decreaseLiquidity",
        args: [
          {
            tokenId,
            liquidity: position[6] as bigint,
            amount0Min: 0n,
            amount1Min: 0n,
            deadline: await deadline(),
          },
        ],
      }),
    );
    await send(
      list.positionManager,
      encodeFunctionData({
        abi: NFPM_ABI,
        functionName: "collect",
        args: [{ tokenId, recipient: OWNER, amount0Max: MAX_UINT128, amount1Max: MAX_UINT128 }],
      }),
    );
  }

  /** What took `owner`'s `nonce`, looked for from `fromBlock` on; hardhat mines one transaction per block. */
  async function sentWithNonce({ owner, nonce, fromBlock }: { owner: Address; nonce: number; fromBlock: bigint }) {
    const [mined, pending] = await Promise.all([
      client.getTransactionCount({ address: owner, blockTag: "latest" }),
      client.getTransactionCount({ address: owner, blockTag: "pending" }),
    ]);
    if (mined <= nonce) return pending > nonce ? { status: "pending" as const } : { status: "none" as const };
    const head = await client.getBlockNumber({ cacheTime: 0 });
    for (let number = fromBlock; number <= head; number++) {
      const block = await client.getBlock({ blockNumber: number, includeTransactions: true });
      const sent = block.transactions.find(
        (tx) => tx.from.toLowerCase() === owner.toLowerCase() && tx.nonce === nonce && tx.to !== null,
      );
      if (sent)
        return { status: "mined" as const, hash: sent.hash, to: sent.to!, input: sent.input, value: sent.value };
    }
    return { status: "taken" as const };
  }

  const resolve = (args: string[]) =>
    execFileSync("yarn", ["simulate:resolve:gnosis-fork", "--session", sessionId.toString(), ...args], {
      cwd: REPO_ROOT,
      stdio: "inherit",
      timeout: SETUP_TIMEOUT_MS,
    });

  /** The wallet's sends through the flow runner, one by one: hardhat answers no EIP-5792 method. */
  async function redeemFromWallet() {
    const input = await app.fetchWalletRedeemInput(client, {
      chainId: CHAIN_ID,
      owner: OWNER,
      sessionFactory: factory,
      sessionId,
    });
    const run = app.createRedeemRun({
      gateway: createViemTxGateway({
        client,
        sendTransaction: async (tx) => {
          const call = { account: OWNER, to: tx.to, data: tx.data, value: tx.value } as const;
          const gas = ((await client.estimateGas(call)) * 3n) / 2n;
          return wallet.sendTransaction({ ...call, chain: gnosis, gas });
        },
      }),
      wallet: {
        request: async ({ method }: { method: string; params?: unknown }) => {
          if (method === "wallet_getCapabilities") return {};
          throw Object.assign(new Error(`${method} is not supported`), { code: 4200 });
        },
      },
      reader: {
        nextNonce: (account: Address) => client.getTransactionCount({ address: account, blockTag: "latest" }),
        hasPending: async (account: Address) => {
          const [pending, latest] = await Promise.all([
            client.getTransactionCount({ address: account, blockTag: "pending" }),
            client.getTransactionCount({ address: account, blockTag: "latest" }),
          ]);
          return pending > latest;
        },
        blockNumber: () => client.getBlockNumber({ cacheTime: 0 }),
        sentWithNonce,
        balanceOf: (token: Address, account: Address) => balanceOf(token, account),
      },
      store: createFlowRunStore({ storage: createMemoryStorage() }),
      flowId: `redeem-fork-${sessionId}`,
      account: () => OWNER,
      chainId: () => CHAIN_ID,
      request: () => input,
      pollMs: 100,
    });
    const progress = await new Promise<{ stage: string; failure?: unknown }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("the run did not settle")), RUN_TIMEOUT_MS - 10_000);
      const check = () => {
        const now = run.getProgress();
        if (now.stage === "complete" || (now.stage === "halted" && now.failure)) {
          clearTimeout(timer);
          unsubscribe();
          resolve(now);
        }
      };
      const unsubscribe = run.subscribe(check);
      run.start();
      check();
    });
    run.dispose();
    return { input, progress };
  }

  beforeAll(async () => {
    if (new URL(FORK_RPC_URL!).origin !== new URL(HARDHAT_FORK_URL).origin) {
      throw new Error(`simulate-resolve reaches the fork at ${HARDHAT_FORK_URL}; FORK_RPC_URL is ${FORK_RPC_URL}`);
    }
    app = await load();
    const transport = http(FORK_RPC_URL, { timeout: FORK_RPC_TIMEOUT_MS });
    client = createPublicClient({ chain: gnosis, transport, pollingInterval: 100 }) as PublicClient;
    wallet = createWalletClient({ chain: gnosis, transport, pollingInterval: 100 });
    factory = app.sessionFactoryAddress(CHAIN_ID)!;
    router = app.gnosisRouterAddress(CHAIN_ID)!;
    const route = app.sDaiDepositRoute(S_DAI, CHAIN_ID);
    if (!factory || !router || !route) throw new Error("This chain is missing a deployment the test needs.");

    snapshotId = await rpc<string>("evm_snapshot");
    await rpc("hardhat_impersonateAccount", [OWNER]);
    await rpc("hardhat_setBalance", [OWNER, hex(parseEther("10000"))]);
    await send(
      route.sDaiAdapter,
      encodeFunctionData({ abi: app.sDaiAdapterAbi, functionName: "depositXDAI", args: [OWNER] }),
      parseEther("100"),
    );

    const outcomes = ["Option A", "Option B"];
    const openingTime = Number((await client.getBlock({ blockTag: "latest" })).timestamp) + 7 * 24 * 60 * 60;
    await send(
      factory,
      encodeFunctionData({
        abi: app.sessionFactoryAbi,
        functionName: "deploySession",
        args: [
          {
            parent: {
              marketName: `Which options will the wallet redeem fork test pick? (${Date.now()})`,
              outcomes,
              tokenNames: outcomes.map((_, index) => `WRDM_${index}`),
              category: "misc",
              lang: "en",
              minBond: parseEther("1"),
              openingTime,
            },
            children: outcomes.map((name, index) => ({
              parentOutcomeIndex: BigInt(index),
              marketName: `What score will ${name} get?[%]`,
              outcomes: ["DOWN", "UP"],
              tokenNames: [`WRDM_${index}_DOWN`, `WRDM_${index}_UP`],
              lowerBound: 0n,
              upperBound: parseEther("100"),
              minBond: parseEther("1"),
              openingTime,
              category: "misc",
              lang: "en",
            })),
            multiCategoricalParent: true,
            metadataUri: "ipfs://wallet-redeem-fork-test",
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
    parentTokens = await Promise.all([0, 1, 2].map((index) => wrapped(parentMarket, index)));
    childTokens = await Promise.all(
      childMarkets.map((child) => Promise.all([DOWN, UP, INVALID].map((index) => wrapped(child, index)))),
    );
    const proxy = await read<Address>({ address: parentMarket, abi: MARKET_ABI, functionName: "realityProxy" });
    conditionalTokens = await read<Address>({
      address: proxy,
      abi: REALITY_PROXY_ABI,
      functionName: "conditionalTokens",
    });

    await split(S_DAI, parentMarket, parseEther("9"));
    await split(parentTokens[0]!, childMarkets[0]!, parseEther("4") + 1_234_567n);
    await split(parentTokens[1]!, childMarkets[1]!, parseEther("3"));
    const upPosition = await addLiquidity(childTokens[0]![UP]!, parentTokens[0]!, parseEther("2") - 7n);
    const downPosition = await addLiquidity(childTokens[0]![DOWN]!, parentTokens[0]!, parseEther("1") + 13n);

    resolve(["--winners", "0,1", "--children", "0=42"]);

    await removeLiquidity(upPosition);
    await removeLiquidity(downPosition);
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    if (!snapshotId) return;
    const head = BigInt(await rpc<string>("eth_blockNumber"));
    await rpc("evm_revert", [snapshotId]);
    // the indexer reads a rewound height as a reorg; mining past the highest height lets it settle
    const rewound = BigInt(await rpc<string>("eth_blockNumber"));
    if (rewound <= head) await rpc("hardhat_mine", [hex(head - rewound + 1n)]);
  });

  /** The payout worked out here from the chain's numerators and the wallet's balances (R5). */
  async function expectedPayout() {
    const parent = await chainPayouts(parentMarket, 3);
    const child = await chainPayouts(childMarkets[0]!, 3);
    const parentPart = (await holdings(parentTokens)).reduce(
      (sum, balance, index) => sum + floorPay(balance, parent.payoutNumerators[index]!, parent.payoutDenominator),
      0n,
    );
    const outcomeTokens = (await holdings(childTokens[0]!)).reduce(
      (sum, balance, slot) => sum + floorPay(balance, child.payoutNumerators[slot]!, child.payoutDenominator),
      0n,
    );
    return parentPart + floorPay(outcomeTokens, parent.payoutNumerators[0]!, parent.payoutDenominator);
  }

  it(
    "A1 plans the computed sDAI for the tokens Remove gave back, and leaves the unresolved winner waiting",
    async () => {
      expect((await chainPayouts(childMarkets[1]!, 3)).payoutDenominator).toBe(0n);
      const input = await app.fetchWalletRedeemInput(client, {
        chainId: CHAIN_ID,
        owner: OWNER,
        sessionFactory: factory,
        sessionId,
      });

      const plan = app.planWalletRedeem(input);

      expect(plan.payout).toBe(await expectedPayout());
      expect(plan.payout).toBeGreaterThan(0n);
      expect(plan.waiting).toEqual([1]);
      expect(plan.calls.length).toBeGreaterThan(0);
    },
    RUN_TIMEOUT_MS,
  );

  it(
    "A1 Redeem pays the computed sDAI to the connected wallet and zeroes the redeemed tokens",
    async () => {
      const expected = await expectedPayout();
      const redeemed = [parentTokens[0]!, parentTokens[1]!, childTokens[0]![DOWN]!, childTokens[0]![UP]!];
      const kept = [parentTokens[2]!, childTokens[0]![INVALID]!, ...childTokens[1]!];
      expect((await holdings(redeemed)).every((each) => each > 0n)).toBe(true);
      const keptBefore = await holdings(kept);
      const sDaiBefore = await balanceOf(S_DAI);

      const { progress } = await redeemFromWallet();

      expect(progress.failure).toBeUndefined();
      expect(progress.stage).toBe("complete");
      expect((await balanceOf(S_DAI)) - sDaiBefore).toBe(expected);
      expect(await holdings(redeemed)).toEqual(redeemed.map(() => 0n));
      expect(await holdings(kept)).toEqual(keptBefore);

      const again = app.planWalletRedeem(
        await app.fetchWalletRedeemInput(client, {
          chainId: CHAIN_ID,
          owner: OWNER,
          sessionFactory: factory,
          sessionId,
        }),
      );
      expect(again.calls).toEqual([]);
      expect(again.payout).toBe(0n);
      expect(again.waiting).toEqual([1]);
    },
    RUN_TIMEOUT_MS,
  );
});
