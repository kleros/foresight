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
  zeroAddress,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { gnosis } from "viem/chains";
import { afterAll, afterEach, beforeAll, beforeEach, expect } from "vitest";

import { decode, movedSqrtPrice, sortPair } from "./session";
import { LIQUIDITY_ALLOW_LIST } from "../../../oracle/allowlist";
import type {
  LiquidityProgress,
  LiquidityReader,
  LiquidityRequest,
  LiquiditySession,
  SeedCollateral,
  SeedInput,
} from "../../../types";

/**
 * A Gnosis fork harness for the liquidity flow: a fresh two-outcome session deployed through the live
 * SessionFactory, an impersonated owner and stranger, and the real driver. Every test runs inside an evm snapshot.
 */
export const FORK_RPC_URL = process.env.FORK_RPC_URL;
const FORK_RPC_TIMEOUT_MS = 60_000;
export const RUN_TIMEOUT_MS = 300_000;
export const CHAIN_ID = 100;

export const OWNER: Address = "0x1a00000000000000000000000000000000000b22";
export const STRANGER: Address = "0x5700000000000000000000000000000000000ff6";

export const LIST = LIQUIDITY_ALLOW_LIST[CHAIN_ID]!;
const S_DAI: Address = "0xaf204776c7245bF4147c2612BF6e5972Ee483701";

const load = async () => ({
  ...(await import("../../plan")),
  ...(await import("../../../run/driver")),
  ...(await import("@/config/contracts")),
});
type App = Awaited<ReturnType<typeof load>>;

const MARKET_ABI = parseAbi([
  "function wrappedOutcome(uint256 index) view returns (address wrapped1155, bytes data)",
  "function numOutcomes() view returns (uint256)",
]);
const NFPM_ABI = parseAbi([
  "function createAndInitializePoolIfNecessary(address token0, address token1, uint160 sqrtPriceX96) payable returns (address pool)",
  "function mint((address token0, address token1, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
  "function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
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

export const hex = (value: bigint) => `0x${value.toString(16)}`;

interface Sent {
  tx: FlowTx;
  hash?: Hash;
  error?: unknown;
  before: Map<string, bigint>;
  nativeBefore: bigint;
}

export interface Position {
  tokenId: bigint;
  token0: Address;
  token1: Address;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
}

/** Hardhat mines a send that reverts and answers it with an RPC error whose `data.txHash` names the mined send. */
function minedHash(error: unknown): Hash | undefined {
  for (let at = error; typeof at === "object" && at !== null; at = (at as { cause?: unknown }).cause) {
    const data = (at as { data?: unknown }).data;
    const hash = typeof data === "object" && data !== null ? (data as { txHash?: unknown }).txHash : undefined;
    if (typeof hash === "string") return hash as Hash;
  }
  return undefined;
}

/** Registers the fork's hooks in the calling describe and returns the helpers its tests use. */
export function useFork() {
  let client!: PublicClient;
  let wallet!: WalletClient;
  let app!: App;
  let session!: LiquiditySession;
  let closesAt!: bigint;
  let sDaiAdapter!: Address;
  let snapshotId = "";
  let highestBlock = 0n;
  let flows = 0;

  const read = <T>(args: Parameters<PublicClient["readContract"]>[0]) => client.readContract(args) as Promise<T>;
  const balanceOf = (token: Address, account: Address = OWNER) =>
    read<bigint>({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account] });

  async function send(from: Address, to: Address, data: Hex, value = 0n) {
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

  const poolAddress = (tokenA: Address, tokenB: Address) =>
    read<Address>({
      address: LIST.algebraFactory,
      abi: FACTORY_ABI,
      functionName: "poolByPair",
      args: [tokenA, tokenB],
    });

  const reader: LiquidityReader = {
    chainTime: async () => (await client.getBlock({ blockTag: "latest" })).timestamp,
    async pool(tokenA, tokenB) {
      const address = await poolAddress(tokenA, tokenB);
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
  };

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

  const sessionTokens = () => [
    session.collateral,
    session.parentInvalid,
    ...session.branches.flatMap((each) => [each.outcome, each.upToken, each.downToken, each.invalidToken]),
  ];

  async function balances(tokens: Address[]) {
    const entries = await Promise.all(tokens.map(async (token) => [token.toLowerCase(), await balanceOf(token)]));
    return new Map(entries as [string, bigint][]);
  }

  /** The owner's wallet as the driver's gateway; `beforeSend` acts as another account between a build and its send. */
  function ownerGateway(opts: { beforeSend?: (tx: FlowTx) => Promise<void> } = {}) {
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
        await opts.beforeSend?.(tx);
        const call = { account: OWNER, to: tx.to, data: tx.data, value: tx.value } as const;
        // a send whose estimate fails goes out with fixed gas, so a call that cannot meet its minimums reverts on chain
        const gas = await client.estimateGas(call).then(
          (estimate) => (estimate * 3n) / 2n,
          () => 10_000_000n,
        );
        try {
          record.hash = await wallet.sendTransaction({ ...call, chain: gnosis, gas });
          return record.hash;
        } catch (error) {
          record.error = error;
          record.hash = minedHash(error);
          throw error;
        }
      },
    });
    return {
      port,
      sent,
      async after(index: number) {
        const next = sent[index + 1];
        return next ? next.before : balances(tokens);
      },
      async nativeAfter(index: number) {
        const next = sent[index + 1];
        return next ? next.nativeBefore : client.getBalance({ address: OWNER });
      },
      /** Whether send `index` mined and the contract reverted it; a send that never reached the chain throws. */
      async reverted(index: number) {
        const record = sent[index];
        if (!record) throw new Error(`no send ${index}`);
        if (!record.hash)
          throw new Error(`send ${index} never reached the chain: ${String(record.error).slice(0, 600)}`);
        return (await client.getTransactionReceipt({ hash: record.hash })).status === "reverted";
      },
    };
  }

  const sequentialWallet = {
    request: async ({ method }: { method: string; params?: unknown }) => {
      if (method === "wallet_getCapabilities") return {};
      throw Object.assign(new Error(`${method} is not supported`), { code: 4200 });
    },
  };

  async function drive(request: LiquidityRequest, gateway: ReturnType<typeof ownerGateway>) {
    const driver = app.createLiquidityRun({
      gateway: gateway.port,
      wallet: sequentialWallet,
      reader,
      store: createFlowRunStore({ storage: createMemoryStorage() }),
      flowId: `liquidity-fork-money-${(flows += 1)}`,
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

  const fundSDai = (account: Address, xdai: bigint) =>
    send(
      account,
      sDaiAdapter,
      encodeFunctionData({ abi: app.sDaiAdapterAbi, functionName: "depositXDAI", args: [account] }),
      xdai,
    );

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

  /** The stranger swaps in the pool until its price has moved `ticks` ticks; returns the target sqrt price. */
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
  const isSeedMint = (tx: FlowTx, outcome: Address) => {
    const decoded = kindOf(tx);
    return (
      decoded.kind === "multicall" &&
      decoded.inner.filter((call) => call.name === "mint").length === 2 &&
      decoded.inner.some(
        (call) =>
          call.name === "mint" && (isAddressEqual(call.token0, outcome) || isAddressEqual(call.token1, outcome)),
      )
    );
  };
  const isWithdraw = (tx: FlowTx) => {
    const decoded = kindOf(tx);
    return decoded.kind === "multicall" && decoded.inner.some((call) => call.name === "decreaseLiquidity");
  };

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
              marketName: `Which option will the liquidity money fork test pick? (${Date.now()})`,
              outcomes,
              tokenNames: ["LQM_A", "LQM_B"],
              category: "misc",
              lang: "en",
              minBond: parseEther("1"),
              openingTime,
            },
            children: outcomes.map((label, index) => ({
              parentOutcomeIndex: BigInt(index),
              marketName: `What score will ${label} get?[%]`,
              outcomes: ["DOWN", "UP"],
              tokenNames: [`LQM_${index}_DOWN`, `LQM_${index}_UP`],
              lowerBound: 0n,
              upperBound: parseEther("100"),
              minBond: parseEther("1"),
              openingTime,
              category: "misc",
              lang: "en",
            })),
            multiCategoricalParent: false,
            metadataUri: "ipfs://liquidity-fork-money-test",
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
    const parentMarket = deployed.parentMarket;
    const numOutcomes = await read<bigint>({ address: parentMarket, abi: MARKET_ABI, functionName: "numOutcomes" });
    session = {
      chainId: CHAIN_ID,
      parentMarket,
      collateral: S_DAI,
      parentInvalid: await wrapped(parentMarket, numOutcomes),
      branches: await Promise.all(
        deployed.childMarkets.map(async (childMarket, index) => ({
          childMarket,
          outcome: await wrapped(parentMarket, BigInt(index)),
          downToken: await wrapped(childMarket, 0n),
          upToken: await wrapped(childMarket, 1n),
          invalidToken: await wrapped(childMarket, 2n),
        })),
      ),
    };
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

  // The indexer reads a rewound height as a reorg; mining past every height reached lets it settle.
  afterAll(async () => {
    if (highestBlock === 0n) return;
    const head = BigInt(await rpc<string>("eth_blockNumber"));
    if (head <= highestBlock) await rpc("hardhat_mine", [hex(highestBlock - head + 1n)]);
  });

  return {
    rpc,
    get app() {
      return app;
    },
    get session() {
      return session;
    },
    balanceOf,
    send,
    approve,
    reader,
    poolPrice,
    positionsOf,
    inPool,
    ownerGateway,
    drive,
    seedRequest,
    fundSDai,
    strangerHolds,
    createPool,
    strangerMints,
    strangerMoves,
    kindOf,
    isSeedMint,
    isWithdraw,
    burned: (tokenId: bigint) =>
      reader.ownerOf(tokenId).then(
        () => false,
        () => true,
      ),
    previewDeposit: (assets: bigint) =>
      read<bigint>({
        address: session.collateral,
        abi: parseAbi(["function previewDeposit(uint256 assets) view returns (uint256)"]),
        functionName: "previewDeposit",
        args: [assets],
      }),
    nativeOf: (account: Address) => client.getBalance({ address: account }),
  };
}
