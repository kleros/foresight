// @vitest-environment node
import { createFlowRunStore, createMemoryStorage, createViemTxGateway, type FlowTx } from "@foresight/tx-orchestrator";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  http,
  isAddressEqual,
  parseAbi,
  parseEther,
  parseEventLogs,
  toFunctionSelector,
  zeroAddress,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { gnosis } from "viem/chains";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { tickAtSqrtPrice } from "@/lib/swap/tickMath";

import { decode, leftoverOf, movedSqrtPrice, sortPair, userSqrtPrice } from "./support/session";
import { LIQUIDITY_ALLOW_LIST } from "../../oracle/allowlist";
import {
  DUST_WEI,
  GAS_RESERVE_WEI,
  LIQUIDITY_SLIPPAGE_BPS,
  MINT_RATE_MARGIN_BPS,
  NEW_POOL_TICK_SPACING,
  SEED_PRICE_TOLERANCE_TICKS,
} from "../../oracle/tolerances";
import { readSentWithNonce } from "../../run/sentWithNonce";
import type {
  LiquidityProgress,
  LiquidityReader,
  LiquidityRequest,
  LiquiditySession,
  SeedCollateral,
  SeedInput,
  SeedPlan,
} from "../../types";

/**
 * The liquidity flow against a real chain: `yarn local-stack gnosis-fork`, then this with FORK_RPC_URL set
 * (`yarn workspace web test:fork:liquidity`). A two-outcome session is deployed through the live SessionFactory;
 * every run goes through the real plan and driver from an impersonated account.
 */
const FORK_RPC_URL = process.env.FORK_RPC_URL;
/** A cold fork pulls state from upstream Gnosis on first touch. */
const FORK_RPC_TIMEOUT_MS = 60_000;
const RUN_TIMEOUT_MS = 300_000;
const CHAIN_ID = 100;
const BPS = 10_000n;
const SLIPPAGE = BigInt(LIQUIDITY_SLIPPAGE_BPS);

const OWNER: Address = "0x1a00000000000000000000000000000000000a11";
const STRANGER: Address = "0x5700000000000000000000000000000000000ee5";

const LIST = LIQUIDITY_ALLOW_LIST[CHAIN_ID]!;
/** Gnosis sDAI: Seer's collateral, and the vault an xDAI split deposits into. */
const S_DAI: Address = "0xaf204776c7245bF4147c2612BF6e5972Ee483701";

/** The app's modules read validated env when they load, so they come in inside the tests. */
const load = async () => ({
  ...(await import("../plan")),
  ...(await import("../../run/driver")),
  ...(await import("@/config/contracts")),
});
type App = Awaited<ReturnType<typeof load>>;

const MARKET_ABI = parseAbi([
  "function wrappedOutcome(uint256 index) view returns (address wrapped1155, bytes data)",
  "function numOutcomes() view returns (uint256)",
]);
const NFPM_ABI = parseAbi([
  "function factory() view returns (address)",
  "function createAndInitializePoolIfNecessary(address token0, address token1, uint160 sqrtPriceX96) payable returns (address pool)",
  "function mint((address token0, address token1, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
  "function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]);
const FACTORY_ABI = parseAbi(["function poolByPair(address tokenA, address tokenB) view returns (address)"]);
const POOL_ABI = parseAbi([
  "function globalState() view returns (uint160 price, int24 tick, uint16 fee, uint16 timepointIndex, uint8 communityFeeToken0, uint8 communityFeeToken1, bool unlocked)",
  "function liquidity() view returns (uint128)",
  "function tickSpacing() view returns (int24)",
]);
const SWAP_ABI = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 limitSqrtPrice) params) payable returns (uint256 amountOut)",
]);
const VAULT_ABI = parseAbi(["function previewDeposit(uint256 assets) view returns (uint256)"]);

/** A minimal proxy's runtime code (EIP-1167 and its variants): a PUSH20 of the implementation, then DELEGATECALL. */
const MINIMAL_PROXY = /^0x(?:[0-9a-f]{2}){0,20}73([0-9a-f]{40})5af4(?:[0-9a-f]{2}){0,24}$/i;
/** EIP-1967's implementation slot. */
const IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

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

/** The highest block any test reached before rewinding; a rewound height is re-mined with a new hash. */
let highestBlock = 0n;

// The indexer reads a rewound height as a reorg; mining past every height reached lets it settle.
afterAll(async () => {
  if (!FORK_RPC_URL || highestBlock === 0n) return;
  const head = BigInt(await rpc<string>("eth_blockNumber"));
  if (head <= highestBlock) await rpc("hardhat_mine", [hex(highestBlock - head + 1n)]);
});

interface Sent {
  tx: FlowTx;
  hash?: Hash;
  error?: unknown;
  /** The owner's balances of the tracked tokens just before this send, and its native balance. */
  before: Map<string, bigint>;
  nativeBefore: bigint;
}

interface Position {
  tokenId: bigint;
  token0: Address;
  token1: Address;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
}

describe.skipIf(!FORK_RPC_URL)("the liquidity flow, against a gnosis fork", () => {
  let client: PublicClient;
  let wallet: WalletClient;
  let app: App;
  let session: LiquiditySession;
  let closesAt: bigint;
  let sDaiAdapter: Address;
  let snapshotId: string;
  let flows = 0;

  const read = <T>(args: Parameters<PublicClient["readContract"]>[0]) => client.readContract(args) as Promise<T>;

  const balanceOf = (token: Address, account: Address = OWNER) =>
    read<bigint>({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account] });

  async function send(from: Address, to: Address, data: Hex, value = 0n) {
    // an Algebra mint's estimate can fall short of what the next block charges it
    const gas = ((await client.estimateGas({ account: from, to, data, value })) * 3n) / 2n;
    const hash = await wallet.sendTransaction({ account: from, chain: gnosis, to, data, value, gas });
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`setup transaction to ${to} reverted`);
    return receipt;
  }

  const approve = (from: Address, token: Address, spender: Address, amount: bigint) =>
    send(from, token, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }));

  async function wrapped(market: Address, index: bigint): Promise<Address> {
    const [token] = await read<readonly [Address, Hex]>({
      address: market,
      abi: MARKET_ABI,
      functionName: "wrappedOutcome",
      args: [index],
    });
    return token;
  }

  /** The session's markets and tokens, from `wrappedOutcome(i)` of its own markets. */
  async function readSession(parentMarket: Address, childMarkets: readonly Address[]): Promise<LiquiditySession> {
    const outcomes = await read<bigint>({ address: parentMarket, abi: MARKET_ABI, functionName: "numOutcomes" });
    const branches = await Promise.all(
      childMarkets.map(async (childMarket, index) => ({
        childMarket,
        outcome: await wrapped(parentMarket, BigInt(index)),
        downToken: await wrapped(childMarket, 0n),
        upToken: await wrapped(childMarket, 1n),
        invalidToken: await wrapped(childMarket, 2n),
      })),
    );
    return {
      chainId: CHAIN_ID,
      parentMarket,
      collateral: S_DAI,
      parentInvalid: await wrapped(parentMarket, outcomes),
      branches,
    };
  }

  /** The chain reads the driver makes, straight from the fork. */
  const reader: LiquidityReader = {
    chainTime: async () => (await client.getBlock({ blockTag: "latest" })).timestamp,
    async pool(tokenA, tokenB) {
      const address = await read<Address>({
        address: LIST.algebraFactory,
        abi: FACTORY_ABI,
        functionName: "poolByPair",
        args: [tokenA, tokenB],
      });
      if (isAddressEqual(address, zeroAddress)) return { status: "missing" };
      const [[sqrtPriceX96], liquidity, tickSpacing] = await Promise.all([
        read<readonly [bigint, number, number, number, number, number, boolean]>({
          address,
          abi: POOL_ABI,
          functionName: "globalState",
        }),
        read<bigint>({ address, abi: POOL_ABI, functionName: "liquidity" }),
        read<number>({ address, abi: POOL_ABI, functionName: "tickSpacing" }),
      ]);
      if (sqrtPriceX96 === 0n) return { status: "missing" };
      return liquidity > 0n
        ? { status: "live", sqrtPriceX96, liquidity, tickSpacing }
        : { status: "empty", sqrtPriceX96, tickSpacing };
    },
    ownerOf: (tokenId) =>
      read<Address>({ address: LIST.positionManager, abi: NFPM_ABI, functionName: "ownerOf", args: [tokenId] }),
    nextNonce: (account) => client.getTransactionCount({ address: account, blockTag: "latest" }),
    async hasPending(account) {
      const [pending, latest] = await Promise.all([
        client.getTransactionCount({ address: account, blockTag: "pending" }),
        client.getTransactionCount({ address: account, blockTag: "latest" }),
      ]);
      return pending > latest;
    },
    blockNumber: () => client.getBlockNumber({ cacheTime: 0 }),
    sentWithNonce: (args) => readSentWithNonce(client, args),
  };

  async function poolAddress(tokenA: Address, tokenB: Address) {
    return read<Address>({
      address: LIST.algebraFactory,
      abi: FACTORY_ABI,
      functionName: "poolByPair",
      args: [tokenA, tokenB],
    });
  }

  async function poolPrice(tokenA: Address, tokenB: Address) {
    const [price, tick] = await read<readonly [bigint, number, number, number, number, number, boolean]>({
      address: await poolAddress(tokenA, tokenB),
      abi: POOL_ABI,
      functionName: "globalState",
    });
    return { price, tick };
  }

  async function positionsOf(account: Address): Promise<Position[]> {
    const count = await read<bigint>({
      address: LIST.positionManager,
      abi: NFPM_ABI,
      functionName: "balanceOf",
      args: [account],
    });
    return Promise.all(
      Array.from({ length: Number(count) }, async (_, index) => {
        const tokenId = await read<bigint>({
          address: LIST.positionManager,
          abi: NFPM_ABI,
          functionName: "tokenOfOwnerByIndex",
          args: [account, BigInt(index)],
        });
        const [, , token0, token1, tickLower, tickUpper, liquidity] = await read<
          readonly [bigint, Address, Address, Address, number, number, bigint, bigint, bigint, bigint, bigint]
        >({ address: LIST.positionManager, abi: NFPM_ABI, functionName: "positions", args: [tokenId] });
        return { tokenId, token0, token1, tickLower, tickUpper, liquidity };
      }),
    );
  }

  const inPool = (position: Position, a: Address, b: Address) => {
    const [token0, token1] = sortPair(a, b);
    return isAddressEqual(position.token0, token0) && isAddressEqual(position.token1, token1);
  };

  const burned = async (tokenId: bigint) =>
    reader.ownerOf(tokenId).then(
      () => false,
      () => true,
    );

  /** Every token of the session, for balance records. */
  const sessionTokens = () => [
    session.collateral,
    session.parentInvalid,
    ...session.branches.flatMap((each) => [each.outcome, each.upToken, each.downToken, each.invalidToken]),
  ];

  async function balances(tokens: Address[]) {
    const entries = await Promise.all(tokens.map(async (token) => [token.toLowerCase(), await balanceOf(token)]));
    return new Map(entries as [string, bigint][]);
  }

  /**
   * The owner's wallet as the driver's gateway: each send records the owner's balances first, then runs
   * `beforeSend` (another account acting between the step's build and its send), then broadcasts. A send whose
   * estimate fails goes out with fixed gas, so a mint that cannot meet its minimums reverts on chain.
   */
  function ownerGateway(opts: { beforeSend?: (tx: FlowTx, index: number) => Promise<void> } = {}) {
    const sent: Sent[] = [];
    const tokens = sessionTokens();
    const port = createViemTxGateway({
      client,
      sendTransaction: async (tx) => {
        const record: Sent = {
          tx,
          before: await balances(tokens),
          nativeBefore: await client.getBalance({ address: OWNER }),
        };
        sent.push(record);
        await opts.beforeSend?.(tx, sent.length - 1);
        const call = { account: OWNER, to: tx.to, data: tx.data, value: tx.value } as const;
        const gas = await client.estimateGas(call).then(
          (estimate) => (estimate * 3n) / 2n,
          () => 10_000_000n,
        );
        try {
          record.hash = await wallet.sendTransaction({ ...call, chain: gnosis, gas });
          return record.hash;
        } catch (error) {
          record.error = error;
          throw error;
        }
      },
    });
    return {
      port,
      sent,
      /** The owner's balances once send `index` settled: before the next send, or now. */
      async after(index: number) {
        const next = sent[index + 1];
        return next ? next.before : balances(tokens);
      },
      async nativeAfter(index: number) {
        const next = sent[index + 1];
        return next ? next.nativeBefore : client.getBalance({ address: OWNER });
      },
      async reverted(index: number) {
        const record = sent[index]!;
        if (record.error !== undefined || !record.hash) return true;
        return (await client.getTransactionReceipt({ hash: record.hash })).status === "reverted";
      },
    };
  }

  /** A wallet that reports no atomic batching, so every run signs one transaction at a time. */
  const sequentialWallet = {
    request: async ({ method }: { method: string; params?: unknown }) => {
      if (method === "wallet_getCapabilities") return {};
      throw Object.assign(new Error(`${method} is not supported`), { code: 4200 });
    },
  };

  /** Runs `request` through the real driver to the end: complete, halted or moved. */
  async function drive(request: LiquidityRequest, gateway: ReturnType<typeof ownerGateway>) {
    const driver = app.createLiquidityRun({
      gateway: gateway.port,
      wallet: sequentialWallet,
      reader,
      store: createFlowRunStore({ storage: createMemoryStorage() }),
      flowId: `liquidity-fork-${(flows += 1)}`,
      account: () => OWNER,
      chainId: () => CHAIN_ID,
      request: () => request,
      closesAt,
      pollMs: 100,
    });
    const progress = await new Promise<LiquidityProgress>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("the run did not settle")), RUN_TIMEOUT_MS - 10_000);
      const check = () => {
        const now = driver.getProgress();
        if (now.stage === "complete" || now.stage === "halted" || now.stage === "moved") {
          clearTimeout(timer);
          unsubscribe();
          resolve(now);
        }
      };
      const unsubscribe = driver.subscribe(check);
      driver.start();
      check();
    });
    driver.dispose();
    return progress;
  }

  /** What the popup reviews for a seed: the session's pools as they read now. */
  async function seedRequest(args: {
    total: bigint;
    collateral?: SeedCollateral;
    previewDeposit?: bigint;
    branches: { depth: bigint; upPriceBps: bigint }[];
  }): Promise<LiquidityRequest> {
    const branches = await Promise.all(
      args.branches.map(async (each, index) => {
        const tokens = session.branches[index]!;
        const [up, down] = await Promise.all([
          reader.pool(tokens.upToken, tokens.outcome),
          reader.pool(tokens.downToken, tokens.outcome),
        ]);
        return { ...each, pools: { up, down } };
      }),
    );
    const input: SeedInput = {
      session,
      owner: OWNER,
      total: args.total,
      collateral: args.collateral ?? "sDAI",
      ...(args.previewDeposit === undefined ? {} : { previewDeposit: args.previewDeposit }),
      chainTime: await reader.chainTime(),
      branches,
    };
    return { kind: "seed", input };
  }

  const shown = (request: LiquidityRequest): SeedPlan => {
    if (request.kind !== "seed") throw new Error("not a seed");
    return app.planSeed(request.input);
  };

  async function fundSDai(account: Address, xdai: bigint) {
    await send(
      account,
      sDaiAdapter,
      encodeFunctionData({ abi: app.sDaiAdapterAbi, functionName: "depositXDAI", args: [account] }),
      xdai,
    );
  }

  /** Gives the stranger UP, DOWN and INVALID of branch `index` and the parent outcome they pair with. */
  async function strangerHolds(index: number, xdai: bigint) {
    const tokens = session.branches[index]!;
    await send(
      STRANGER,
      LIST.gnosisRouter,
      encodeFunctionData({ abi: app.gnosisRouterAbi, functionName: "splitFromBase", args: [session.parentMarket] }),
      xdai,
    );
    const half = (await balanceOf(tokens.outcome, STRANGER)) / 2n;
    await approve(STRANGER, tokens.outcome, LIST.gnosisRouter, half);
    await send(
      STRANGER,
      LIST.gnosisRouter,
      encodeFunctionData({
        abi: app.gnosisRouterAbi,
        functionName: "splitPosition",
        args: [session.collateral, tokens.childMarket, half],
      }),
    );
  }

  const createPool = (from: Address, child: Address, outcome: Address, sqrtPriceX96: bigint) => {
    const [token0, token1] = sortPair(child, outcome);
    return send(
      from,
      LIST.positionManager,
      encodeFunctionData({
        abi: NFPM_ABI,
        functionName: "createAndInitializePoolIfNecessary",
        args: [token0, token1, sqrtPriceX96],
      }),
    );
  };

  /** The stranger's full-range position at the pool's own price, of up to `amount` of each token. */
  async function strangerMints(child: Address, outcome: Address, amount: bigint) {
    const [token0, token1] = sortPair(child, outcome);
    const spacing = await read<number>({
      address: await poolAddress(token0, token1),
      abi: POOL_ABI,
      functionName: "tickSpacing",
    });
    const tick = 887272 - (887272 % spacing);
    await approve(STRANGER, token0, LIST.positionManager, amount);
    await approve(STRANGER, token1, LIST.positionManager, amount);
    await send(
      STRANGER,
      LIST.positionManager,
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
            recipient: STRANGER,
            deadline: (await reader.chainTime()) + 3_600n,
          },
        ],
      }),
    );
  }

  /** The stranger swaps in the pool until its price has moved `ticks` ticks. */
  async function strangerMoves(child: Address, outcome: Address, ticks: number) {
    const [token0, token1] = sortPair(child, outcome);
    const { price } = await poolPrice(token0, token1);
    const target = movedSqrtPrice(price, ticks);
    const [tokenIn, tokenOut] = target > price ? [token1, token0] : [token0, token1];
    const amountIn = await balanceOf(tokenIn, STRANGER);
    await approve(STRANGER, tokenIn, LIST.swaprRouter, amountIn);
    await send(
      STRANGER,
      LIST.swaprRouter,
      encodeFunctionData({
        abi: SWAP_ABI,
        functionName: "exactInputSingle",
        args: [
          {
            tokenIn,
            tokenOut,
            recipient: STRANGER,
            deadline: (await reader.chainTime()) + 3_600n,
            amountIn,
            amountOutMinimum: 0n,
            limitSqrtPrice: target,
          },
        ],
      }),
    );
    return target;
  }

  const kindOf = (tx: FlowTx) => decode(tx);
  const mintCount = (tx: FlowTx) => {
    const decoded = kindOf(tx);
    return decoded.kind === "multicall" ? decoded.inner.filter((call) => call.name === "mint").length : 0;
  };
  const isSeedMint = (tx: FlowTx, outcome: Address) => {
    const decoded = kindOf(tx);
    return (
      decoded.kind === "multicall" &&
      mintCount(tx) === 2 &&
      decoded.inner.some(
        (call) =>
          call.name === "mint" && (isAddressEqual(call.token0, outcome) || isAddressEqual(call.token1, outcome)),
      )
    );
  };
  const isDustMint = (tx: FlowTx) => {
    const decoded = kindOf(tx);
    return decoded.kind === "multicall" && decoded.inner.length === 1 && decoded.inner[0]!.name === "mint";
  };
  const isWithdraw = (tx: FlowTx) => {
    const decoded = kindOf(tx);
    return decoded.kind === "multicall" && decoded.inner.some((call) => call.name === "decreaseLiquidity");
  };

  /** The NFT the position manager minted in send `hash`. */
  async function mintedIn(hash: Hash): Promise<bigint> {
    const receipt = await client.getTransactionReceipt({ hash });
    const minted = parseEventLogs({ abi: NFPM_ABI, eventName: "Transfer", logs: receipt.logs }).find(
      (log) => isAddressEqual(log.address, LIST.positionManager) && isAddressEqual(log.args.from, zeroAddress),
    );
    if (!minted) throw new Error(`no position minted in ${hash}`);
    return minted.args.tokenId;
  }

  const tickOf = (sqrtPriceX96: bigint) => tickAtSqrtPrice(sqrtPriceX96);

  beforeAll(async () => {
    const transport = http(FORK_RPC_URL, { timeout: FORK_RPC_TIMEOUT_MS });
    client = createPublicClient({ chain: gnosis, transport, pollingInterval: 100 }) as PublicClient;
    wallet = createWalletClient({ chain: gnosis, transport, pollingInterval: 100 });
    app = await load();
    const route = app.sDaiDepositRoute(S_DAI, CHAIN_ID);
    const factory = app.sessionFactoryAddress(CHAIN_ID);
    if (!route || !factory) throw new Error("This chain is missing the Seer or SessionFactory deployment.");
    sDaiAdapter = route.sDaiAdapter;

    for (const account of [OWNER, STRANGER]) {
      await rpc("hardhat_impersonateAccount", [account]);
      await rpc("hardhat_setBalance", [account, hex(parseEther("10000"))]);
    }

    // a fresh two-outcome session, so every pool of it starts missing
    const openingTime = Number((await client.getBlock({ blockTag: "latest" })).timestamp) + 7 * 24 * 60 * 60;
    closesAt = BigInt(openingTime);
    const outcomes = ["Option A", "Option B"];
    await send(
      OWNER,
      factory,
      encodeFunctionData({
        abi: app.sessionFactoryAbi,
        functionName: "deploySession",
        args: [
          {
            parent: {
              marketName: `Which option will the liquidity fork test pick? (${Date.now()})`,
              outcomes,
              tokenNames: ["LQF_A", "LQF_B"],
              category: "misc",
              lang: "en",
              minBond: parseEther("1"),
              openingTime,
            },
            children: outcomes.map((label, index) => ({
              parentOutcomeIndex: BigInt(index),
              marketName: `What score will ${label} get?[%]`,
              outcomes: ["DOWN", "UP"],
              tokenNames: [`LQF_${index}_DOWN`, `LQF_${index}_UP`],
              lowerBound: 0n,
              upperBound: parseEther("100"),
              minBond: parseEther("1"),
              openingTime,
              category: "misc",
              lang: "en",
            })),
            multiCategoricalParent: false,
            metadataUri: "ipfs://liquidity-fork-test",
          },
        ],
      }),
    );
    const count = await read<bigint>({ address: factory, abi: app.sessionFactoryAbi, functionName: "sessionCount" });
    const deployed = await read<{ parentMarket: Address; childMarkets: readonly Address[] }>({
      address: factory,
      abi: app.sessionFactoryAbi,
      functionName: "getSession",
      args: [count - 1n],
    });
    session = await readSession(deployed.parentMarket, deployed.childMarkets);
    for (const token of sessionTokens()) expect(isAddressEqual(token, zeroAddress)).toBe(false);
  }, 240_000);

  beforeEach(async () => {
    snapshotId = await rpc<string>("evm_snapshot");
    for (const account of [OWNER, STRANGER]) await rpc("hardhat_setBalance", [account, hex(parseEther("10000"))]);
  });

  afterEach(async () => {
    const head = BigInt(await rpc<string>("eth_blockNumber"));
    if (head > highestBlock) highestBlock = head;
    await rpc("evm_revert", [snapshotId]);
  });

  // ------------------------------------------------------------------------------------------------ A1

  describe("seeding a new session", () => {
    it(
      "leaves four pools at the chosen prices, the wallet moved exactly as the plan showed, the NFTs with the owner, and no parent pool",
      async () => {
        await fundSDai(OWNER, parseEther("50"));
        const sDaiBefore = await balanceOf(session.collateral);
        const prices = [6_000n, 2_500n];
        const request = await seedRequest({
          total: parseEther("20"),
          branches: [
            { depth: parseEther("20"), upPriceBps: prices[0]! },
            { depth: parseEther("12"), upPriceBps: prices[1]! },
          ],
        });
        const plan = shown(request);
        const gateway = ownerGateway();

        const progress = await drive(request, gateway);
        expect(progress).toEqual({ stage: "complete" });

        // every pool the run made sits within tolerance of the price the user chose
        for (const [index, tokens] of session.branches.entries()) {
          const upBps = prices[index]!;
          for (const [child, bps] of [
            [tokens.upToken, upBps],
            [tokens.downToken, BPS - upBps],
          ] as const) {
            const childIsToken0 = BigInt(child) < BigInt(tokens.outcome);
            const { tick } = await poolPrice(child, tokens.outcome);
            expect(Math.abs(tick - tickOf(userSqrtPrice(bps, childIsToken0)))).toBeLessThanOrEqual(
              SEED_PRICE_TOLERANCE_TICKS,
            );
            const spacing = await read<number>({
              address: await poolAddress(child, tokens.outcome),
              abi: POOL_ABI,
              functionName: "tickSpacing",
            });
            expect(spacing).toBe(NEW_POOL_TICK_SPACING);
          }
        }

        // L1: the wallet holds exactly the leftovers the popup listed, and paid exactly the parent split
        expect(sDaiBefore - (await balanceOf(session.collateral))).toBe(plan.parentSplit);
        for (const token of sessionTokens().slice(1)) {
          expect({ token, balance: await balanceOf(token) }).toEqual({
            token,
            balance: leftoverOf(plan.leftovers, token),
          });
        }

        // one position per pool, owned by the account, holding the liquidity the plan showed
        const positions = await positionsOf(OWNER);
        expect(positions).toHaveLength(4);
        for (const pool of plan.branches.flatMap((branch) => [branch.pools.up, branch.pools.down])) {
          const held = positions.filter((position) => inPool(position, pool.token0, pool.token1));
          expect(held).toHaveLength(1);
          expect(held[0]!.liquidity).toBe(pool.liquidity);
          expect(isAddressEqual(await reader.ownerOf(held[0]!.tokenId), OWNER)).toBe(true);
        }

        // the parent market's tokens are paired with nothing
        const parentTokens = [session.collateral, session.parentInvalid, ...session.branches.map((b) => b.outcome)];
        for (const [at, a] of parentTokens.entries()) {
          for (const b of parentTokens.slice(at + 1)) {
            expect(await poolAddress(a, b)).toBe(zeroAddress);
          }
        }
      },
      RUN_TIMEOUT_MS,
    );
  });

  // ------------------------------------------------------------------------------------------------ A2

  describe("pools another account got to first", () => {
    it(
      "realigns a pool initialized empty at UP 0.01 and seeds it at the user's price, giving the owner's dust back",
      async () => {
        const tokens = session.branches[0]!;
        const upIsToken0 = BigInt(tokens.upToken) < BigInt(tokens.outcome);
        await createPool(STRANGER, tokens.upToken, tokens.outcome, userSqrtPrice(100n, upIsToken0));
        await fundSDai(OWNER, parseEther("50"));

        const request = await seedRequest({
          total: parseEther("20"),
          branches: [
            { depth: parseEther("20"), upPriceBps: 6_000n },
            { depth: parseEther("10"), upPriceBps: 5_000n },
          ],
        });
        if (request.kind !== "seed") throw new Error("not a seed");
        expect(request.input.branches[0]!.pools.up.status).toBe("empty");
        const plan = shown(request);
        expect(plan.branches[0]!.pools.up.realign).toBe(true);
        const gateway = ownerGateway();

        expect(await drive(request, gateway)).toEqual({ stage: "complete" });

        const { tick } = await poolPrice(tokens.upToken, tokens.outcome);
        expect(Math.abs(tick - tickOf(userSqrtPrice(6_000n, upIsToken0)))).toBeLessThanOrEqual(
          SEED_PRICE_TOLERANCE_TICKS,
        );
        const seeded = (await positionsOf(OWNER)).filter((each) => inPool(each, tokens.upToken, tokens.outcome));
        expect(seeded).toHaveLength(1);
        expect(seeded[0]!.liquidity).toBe(plan.branches[0]!.pools.up.liquidity);

        // L3: dust mint, swap, withdrawal; the dust position is burned and its tokens are back less rounding
        const dust = gateway.sent.findIndex((each) => isDustMint(each.tx));
        const withdraw = gateway.sent.findIndex((each) => isWithdraw(each.tx));
        expect(dust).toBeGreaterThanOrEqual(0);
        expect(withdraw).toBeGreaterThan(dust);
        expect(await burned(await mintedIn(gateway.sent[dust]!.hash!))).toBe(true);
        const before = gateway.sent[dust]!.before;
        const after = await gateway.after(withdraw);
        for (const token of [tokens.upToken, tokens.outcome]) {
          const lost = before.get(token.toLowerCase())! - after.get(token.toLowerCase())!;
          expect({ token, lost: lost >= 0n && lost <= DUST_WEI }).toEqual({ token, lost: true });
        }
      },
      RUN_TIMEOUT_MS,
    );

    it(
      "caps the realign swap when another account adds liquidity before it, withdraws the dust, and stops before the seed mint",
      async () => {
        const tokens = session.branches[0]!;
        const upIsToken0 = BigInt(tokens.upToken) < BigInt(tokens.outcome);
        await createPool(STRANGER, tokens.upToken, tokens.outcome, userSqrtPrice(100n, upIsToken0));
        await strangerHolds(0, parseEther("40"));
        await fundSDai(OWNER, parseEther("50"));

        const request = await seedRequest({
          total: parseEther("20"),
          branches: [
            { depth: parseEther("20"), upPriceBps: 6_000n },
            { depth: parseEther("10"), upPriceBps: 5_000n },
          ],
        });
        let added = false;
        const gateway = ownerGateway({
          beforeSend: async (tx) => {
            if (added || kindOf(tx).kind !== "swap") return;
            added = true;
            await strangerMints(tokens.upToken, tokens.outcome, parseEther("5"));
          },
        });

        const progress = await drive(request, gateway);
        expect(added).toBe(true);
        expect(progress.stage).toBe("moved");

        const swapAt = gateway.sent.findIndex((each) => kindOf(each.tx).kind === "swap");
        const swap = kindOf(gateway.sent[swapAt]!.tx);
        if (swap.kind !== "swap") throw new Error("no swap");
        const spent =
          gateway.sent[swapAt]!.before.get(swap.tokenIn.toLowerCase())! -
          (await gateway.after(swapAt)).get(swap.tokenIn.toLowerCase())!;
        expect(spent).toBeGreaterThan(0n);
        expect(spent).toBeLessThanOrEqual(swap.amountIn);

        // the dust still comes back in full; the pool now holds the other account's liquidity, so no seed mint is signed
        const withdrawAt = gateway.sent.findIndex((each) => isWithdraw(each.tx));
        expect(withdrawAt).toBeGreaterThan(swapAt);
        expect({ dustWithdrawalReverted: await gateway.reverted(withdrawAt) }).toEqual({
          dustWithdrawalReverted: false,
        });
        expect(
          await burned(await mintedIn(gateway.sent[gateway.sent.findIndex((each) => isDustMint(each.tx))]!.hash!)),
        ).toBe(true);
        expect(gateway.sent.filter((each) => isSeedMint(each.tx, tokens.outcome))).toEqual([]);
        const seeded = (await positionsOf(OWNER)).filter(
          (each) => inPool(each, tokens.upToken, tokens.outcome) && each.liquidity > 0n,
        );
        expect(seeded).toEqual([]);
      },
      RUN_TIMEOUT_MS,
    );

    /** A live UP pool of branch 0 at 50%, then a seed whose mint the stranger front-runs by `ticks` ticks. */
    async function seedAfterMove(ticks: number) {
      const tokens = session.branches[0]!;
      const upIsToken0 = BigInt(tokens.upToken) < BigInt(tokens.outcome);
      await strangerHolds(0, parseEther("40"));
      await createPool(STRANGER, tokens.upToken, tokens.outcome, userSqrtPrice(5_000n, upIsToken0));
      await strangerMints(tokens.upToken, tokens.outcome, parseEther("5"));
      await fundSDai(OWNER, parseEther("50"));

      const request = await seedRequest({
        total: parseEther("10"),
        branches: [
          { depth: parseEther("10"), upPriceBps: 5_000n },
          { depth: parseEther("4"), upPriceBps: 5_000n },
        ],
      });
      if (request.kind !== "seed") throw new Error("not a seed");
      expect(request.input.branches[0]!.pools.up.status).toBe("live");
      expect(shown(request).branches[0]!.pools.up.priceLocked).toBe(true);
      let moved = false;
      let movedTo: number | undefined;
      const gateway = ownerGateway({
        beforeSend: async (tx) => {
          if (moved || !isSeedMint(tx, tokens.outcome)) return;
          moved = true;
          const target = await strangerMoves(tokens.upToken, tokens.outcome, ticks);
          movedTo = (await poolPrice(tokens.upToken, tokens.outcome)).tick - tickOf(target);
        },
      });
      const progress = await drive(request, gateway);
      expect(moved).toBe(true);
      // the stranger's swap reached the price it aimed for
      expect(Math.abs(movedTo!)).toBeLessThanOrEqual(1);
      const seedAt = gateway.sent.findIndex((each) => isSeedMint(each.tx, tokens.outcome));
      const seeded = (await positionsOf(OWNER)).filter(
        (each) => inPool(each, tokens.upToken, tokens.outcome) && each.liquidity > 0n,
      );
      return { progress, reverted: await gateway.reverted(seedAt), seeded };
    }

    it(
      "reverts the mint into a live pool moved beyond tolerance between review and send",
      async () => {
        const { progress, reverted, seeded } = await seedAfterMove(400);
        expect(reverted).toBe(true);
        expect(seeded).toEqual([]);
        expect(progress.stage).not.toBe("complete");
      },
      RUN_TIMEOUT_MS,
    );

    it(
      "fills the mint into a live pool moved within tolerance",
      async () => {
        const { progress, reverted, seeded } = await seedAfterMove(-10);
        expect(reverted).toBe(false);
        expect(seeded).toHaveLength(1);
        expect(progress).toEqual({ stage: "complete" });
      },
      RUN_TIMEOUT_MS,
    );
  });

  // ------------------------------------------------------------------------------------------------ A3

  describe("remove and merge", () => {
    async function seeded() {
      await fundSDai(OWNER, parseEther("50"));
      const request = await seedRequest({
        total: parseEther("10"),
        branches: [
          { depth: parseEther("10"), upPriceBps: 7_000n },
          { depth: parseEther("6"), upPriceBps: 3_000n },
        ],
      });
      expect(await drive(request, ownerGateway())).toEqual({ stage: "complete" });
    }

    it(
      "returns the shown amounts of each of a branch's positions within the slippage and burns the NFT",
      async () => {
        await seeded();
        const tokens = session.branches[0]!;
        for (const child of [tokens.upToken, tokens.downToken]) {
          const position = (await positionsOf(OWNER)).find((each) => inPool(each, child, tokens.outcome))!;
          const { price } = await poolPrice(position.token0, position.token1);
          const input = {
            chainId: CHAIN_ID,
            owner: OWNER,
            chainTime: await reader.chainTime(),
            sqrtPriceX96: price,
            position,
          };
          const plan = app.planRemove(input);
          const before = [await balanceOf(position.token0), await balanceOf(position.token1)];

          expect(await drive({ kind: "remove", session, input }, ownerGateway())).toEqual({ stage: "complete" });

          const received = [
            (await balanceOf(position.token0)) - before[0]!,
            (await balanceOf(position.token1)) - before[1]!,
          ];
          for (const [at, amount] of [plan.amount0, plan.amount1].entries()) {
            expect(amount).toBeGreaterThan(0n);
            const off = received[at]! > amount ? received[at]! - amount : amount - received[at]!;
            expect(off).toBeLessThanOrEqual((amount * SLIPPAGE) / BPS);
          }
          expect(await burned(position.tokenId)).toBe(true);
        }
      },
      RUN_TIMEOUT_MS,
    );

    async function mergeBalances() {
      return {
        branches: await Promise.all(
          session.branches.map(async (tokens) => ({
            outcome: await balanceOf(tokens.outcome),
            up: await balanceOf(tokens.upToken),
            down: await balanceOf(tokens.downToken),
            invalid: await balanceOf(tokens.invalidToken),
          })),
        ),
        parentInvalid: await balanceOf(session.parentInvalid),
      };
    }

    async function splitAt(market: Address, collateral: Address, amount: bigint, pulls: Address[]) {
      for (const token of pulls) await approve(OWNER, token, LIST.gnosisRouter, amount);
      await send(
        OWNER,
        LIST.gnosisRouter,
        encodeFunctionData({
          abi: app.gnosisRouterAbi,
          functionName: "splitPosition",
          args: [collateral, market, amount],
        }),
      );
    }

    it(
      "merges complete sets back to sDAI, branch sets of UP, DOWN and INVALID first, then every parent outcome with INVALID",
      async () => {
        await fundSDai(OWNER, parseEther("50"));
        const parentSplit = parseEther("8");
        const branchSplit = parseEther("3");
        await splitAt(session.parentMarket, session.collateral, parentSplit, [session.collateral]);
        await splitAt(session.branches[0]!.childMarket, session.collateral, branchSplit, [
          session.branches[0]!.outcome,
        ]);

        const balances = await mergeBalances();
        const input = { session, owner: OWNER, balances };
        const plan = app.planMerge(input);
        expect(plan.branches[0]!.merge).toBe(branchSplit);
        expect(plan.parentMerge).toBe(parentSplit);
        const sDaiBefore = await balanceOf(session.collateral);

        expect(await drive({ kind: "merge", input }, ownerGateway())).toEqual({ stage: "complete" });

        const tokens = session.branches[0]!;
        for (const token of [tokens.upToken, tokens.downToken, tokens.invalidToken]) {
          expect(await balanceOf(token)).toBe(0n);
        }
        for (const token of [session.parentInvalid, ...session.branches.map((each) => each.outcome)]) {
          expect(await balanceOf(token)).toBe(0n);
        }
        expect((await balanceOf(session.collateral)) - sDaiBefore).toBe(plan.parentMerge);
      },
      RUN_TIMEOUT_MS,
    );

    it(
      "merges at the parent no more than the INVALID it holds",
      async () => {
        await fundSDai(OWNER, parseEther("50"));
        const parentSplit = parseEther("8");
        await splitAt(session.parentMarket, session.collateral, parentSplit, [session.collateral]);
        const given = parseEther("3");
        await send(
          OWNER,
          session.parentInvalid,
          encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [STRANGER, given] }),
        );

        const input = { session, owner: OWNER, balances: await mergeBalances() };
        const plan = app.planMerge(input);
        expect(plan.parentMerge).toBe(parentSplit - given);
        const sDaiBefore = await balanceOf(session.collateral);

        expect(await drive({ kind: "merge", input }, ownerGateway())).toEqual({ stage: "complete" });

        expect((await balanceOf(session.collateral)) - sDaiBefore).toBe(parentSplit - given);
        expect(await balanceOf(session.parentInvalid)).toBe(0n);
        for (const { outcome } of session.branches) expect(await balanceOf(outcome)).toBe(given);
      },
      RUN_TIMEOUT_MS,
    );
  });

  // ------------------------------------------------------------------------------------------------ A4

  describe("the allow-list against the deployed contracts", () => {
    /** The runtime code calls to `address` execute, through an EIP-1167 or EIP-1967 proxy. */
    async function runtimeCode(address: Address): Promise<Hex> {
      const code = (await client.getCode({ address })) ?? "0x";
      const minimal = MINIMAL_PROXY.exec(code);
      if (minimal) return runtimeCode(`0x${minimal[1]}`);
      const slot = await client.getStorageAt({ address, slot: IMPLEMENTATION_SLOT });
      const implementation = slot ? (`0x${slot.slice(-40)}` as Address) : zeroAddress;
      if (!isAddressEqual(implementation, zeroAddress)) return runtimeCode(implementation);
      return code;
    }

    it("names selectors that match their signatures and that the deployed code dispatches", async () => {
      const targets: Record<string, Address[]> = {
        sessionToken: [session.collateral, session.branches[0]!.outcome, session.branches[0]!.upToken],
        gnosisRouter: [LIST.gnosisRouter],
        positionManager: [LIST.positionManager],
        swaprRouter: [LIST.swaprRouter],
      };
      const entries = [
        ...LIST.calls.map((call) => ({ ...call, targets: targets[call.target]! })),
        ...LIST.multicallInner.map((call) => ({ ...call, targets: targets.positionManager! })),
      ];
      expect(entries.length).toBe(LIST.calls.length + LIST.multicallInner.length);
      for (const entry of entries) {
        expect({ name: entry.name, selector: toFunctionSelector(entry.name) }).toEqual({
          name: entry.name,
          selector: entry.selector,
        });
        for (const target of entry.targets) {
          const code = (await runtimeCode(target)).toLowerCase();
          expect({ target, name: entry.name, found: code.includes(entry.selector.slice(2).toLowerCase()) }).toEqual({
            target,
            name: entry.name,
            found: true,
          });
        }
      }
    });

    it("reads its pools from the factory the position manager uses", async () => {
      const factory = await read<Address>({ address: LIST.positionManager, abi: NFPM_ABI, functionName: "factory" });
      expect(isAddressEqual(factory, LIST.algebraFactory)).toBe(true);
    });

    it(
      "creates pools with NEW_POOL_TICK_SPACING, for a child below and above its parent outcome",
      async () => {
        for (const tokens of session.branches) {
          for (const child of [tokens.upToken, tokens.downToken]) {
            await createPool(
              STRANGER,
              child,
              tokens.outcome,
              userSqrtPrice(5_000n, BigInt(child) < BigInt(tokens.outcome)),
            );
            const spacing = await read<number>({
              address: await poolAddress(child, tokens.outcome),
              abi: POOL_ABI,
              functionName: "tickSpacing",
            });
            expect(spacing).toBe(NEW_POOL_TICK_SPACING);
          }
        }
      },
      RUN_TIMEOUT_MS,
    );
  });

  // ------------------------------------------------------------------------------------------------ A5

  describe("seeding from xDAI", () => {
    const previewDeposit = (assets: bigint) =>
      read<bigint>({ address: session.collateral, abi: VAULT_ABI, functionName: "previewDeposit", args: [assets] });

    it(
      "caps each depth at previewDeposit less the margin, and every branch then fills",
      async () => {
        const total = parseEther("10");
        const preview = await previewDeposit(total);
        const cap = preview - (preview * MINT_RATE_MARGIN_BPS) / BPS;
        expect(preview).toBeLessThan(total);
        const request = await seedRequest({
          total,
          collateral: "xDAI",
          previewDeposit: preview,
          branches: [
            { depth: total, upPriceBps: 6_000n },
            { depth: total / 2n, upPriceBps: 4_000n },
          ],
        });
        const plan = shown(request);
        for (const branch of plan.branches) expect(branch.depth).toBeLessThanOrEqual(cap);
        expect(plan.branches[0]!.depth).toBe(cap);
        expect(plan.branches[1]!.depth).toBe(total / 2n);
        const gateway = ownerGateway();

        expect(await drive(request, gateway)).toEqual({ stage: "complete" });

        const split = gateway.sent.findIndex((each) => kindOf(each.tx).kind === "splitFromBase");
        expect(gateway.sent[split]!.tx.value).toBe(total);
        expect(await gateway.nativeAfter(split)).toBeGreaterThanOrEqual(GAS_RESERVE_WEI);
        expect(await positionsOf(OWNER)).toHaveLength(4);
      },
      RUN_TIMEOUT_MS,
    );

    it(
      "never leaves the wallet under GAS_RESERVE_WEI with the split, for a total that would",
      async () => {
        const total = parseEther("10");
        const preview = await previewDeposit(total);
        // what the split would leave is half the reserve, less its own gas
        await rpc("hardhat_setBalance", [OWNER, hex(total + GAS_RESERVE_WEI / 2n)]);
        const request = await seedRequest({
          total,
          collateral: "xDAI",
          previewDeposit: preview,
          branches: [
            { depth: total / 2n, upPriceBps: 6_000n },
            { depth: total / 4n, upPriceBps: 4_000n },
          ],
        });
        const gateway = ownerGateway();

        await drive(request, gateway);

        for (const [index, each] of gateway.sent.entries()) {
          if ((each.tx.value ?? 0n) === 0n || (await gateway.reverted(index))) continue;
          expect(await gateway.nativeAfter(index)).toBeGreaterThanOrEqual(GAS_RESERVE_WEI);
        }
        expect(await client.getBalance({ address: OWNER })).toBeGreaterThanOrEqual(GAS_RESERVE_WEI);
      },
      RUN_TIMEOUT_MS,
    );
  });
});
