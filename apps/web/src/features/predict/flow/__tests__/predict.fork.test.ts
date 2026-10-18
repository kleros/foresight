import { createViemTxGateway, type FlowTx } from "@foresight/tx-orchestrator";
import {
  createPublicClient,
  createWalletClient,
  decodeFunctionData,
  encodeFunctionData,
  erc20Abi,
  http,
  parseAbi,
  parseEther,
  parseEventLogs,
  type Address,
  type Hash,
  type Hex,
  type Log,
  type TransactionReceipt,
  type PrivateKeyAccount,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { gnosis } from "viem/chains";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  gasPaid,
  moved,
  outsideRecipients,
  readLedger,
  signedOptions,
  tokensOf,
  type Ledger,
  type LedgerScope,
} from "./support/ledger";
import { DUST_WEI } from "../../oracle/tolerances";
import { fundingRequest, planFunding, type Funding } from "../../utils/funding";
import type { PredictCtx, PredictOption, PredictRequest, PredictSnapshot } from "../types";

/**
 * The app's modules read validated env when they load, so they are pulled in inside the test
 * rather than at the top: with no fork configured this file has to load and skip, not throw.
 */
const load = async () => ({
  ...(await import("@/lib/swap/lens")),
  ...(await import("@/lib/swap/algebraPool")),
  ...(await import("@/lib/trade-executor/executor")),
  ...(await import("@/config/contracts")),
  ...(await import("../../api/getOptionPools")),
  ...(await import("../../utils/poolMath")),
  ...(await import("../../run/reader")),
  ...(await import("../plan")),
  ...(await import("../../run/driver")),
  ...(await import("@/lib/trade-executor/credits")),
  ...(await import("@/lib/trade-executor/funding")),
  ...(await import("../../utils/credits")),
  ...(await import("../../utils/plan")),
});

/**
 * The predict flow against a real chain: `yarn local-stack gnosis-fork`, then
 * `yarn simulate:session:gnosis-fork --liquidity`, then this with FORK_RPC_URL set.
 *
 * Nothing else exercises the calldata. Every unit test above proves the plan is the plan we
 * meant; only this proves Seer's router and Swapr's pools accept it.
 */
const FORK_RPC_URL = process.env.FORK_RPC_URL;
/** A cold fork pulls state from upstream Gnosis on first touch; a large multicall can take tens of seconds. */
const FORK_RPC_TIMEOUT_MS = 60_000;
const HASURA_URL = process.env.FORK_HASURA_URL ?? "http://localhost:8080/v1/graphql";
const HASURA_SECRET = process.env.FORK_HASURA_SECRET ?? "testing";
/** Hardhat's first account, which a fork funds. */
const OWNER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

/** Seer's LensQuoter on Gnosis, which quotes every swap. */
const LENS_QUOTER = "0x82150d38288e53AfcF20a5eEee47682c5Ef796d8" as const;

/** `yarn local-stack gnosis-fork` copies the LensQuoter onto the fork; its pinned block predates it. */
async function requireLensQuoter(rpcUrl: string): Promise<void> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [LENS_QUOTER, "latest"] }),
  });
  const code = ((await response.json()) as { result?: string }).result;
  if (!code || code === "0x")
    throw new Error("The fork has no LensQuoter. Start it with `yarn local-stack gnosis-fork`.");
}

const DEPOSIT = parseEther("50");
const CHAIN_ID = 100;

interface ForkSession {
  id: string;
  parentMarket: Address;
  collateralToken: Address;
  children: Array<{
    id: Address;
    upToken: Address;
    downToken: Address;
    invalidToken: Address;
    underlyingToken: Address;
    lowerBound: string;
    upperBound: string;
  }>;
}

async function newestSessionWithPools(): Promise<ForkSession> {
  const response = await fetch(HASURA_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-hasura-admin-secret": HASURA_SECRET },
    body: JSON.stringify({
      query: `{ Session(where: {children: {pools: {id: {_is_null: false}}}}, order_by: {openedAt: desc}, limit: 1) { id parentMarket collateralToken
        children { id upToken downToken invalidToken underlyingToken lowerBound upperBound } } }`,
    }),
  });
  const body = (await response.json()) as { data: { Session: ForkSession[] } };
  const session = body.data.Session[0];
  if (!session)
    throw new Error("No session with pools indexed. Run `yarn simulate:session:gnosis-fork --liquidity` first.");
  return session;
}

describe("the predict flow, against a gnosis fork", () => {
  const account = privateKeyToAccount(OWNER_KEY);
  let client: PublicClient;
  let wallet: WalletClient;
  let session: ForkSession;

  beforeAll(async () => {
    if (!FORK_RPC_URL) return;
    const transport = http(FORK_RPC_URL, { timeout: FORK_RPC_TIMEOUT_MS });
    client = createPublicClient({ chain: gnosis, transport }) as PublicClient;
    wallet = createWalletClient({ account, chain: gnosis, transport });
    await requireLensQuoter(FORK_RPC_URL!);
    session = await newestSessionWithPools();
  }, 120_000);

  // the later describes need the pools where the session seeded them
  let snapshotId: string;
  beforeEach(async () => {
    if (!FORK_RPC_URL) return;
    snapshotId = await rpc<string>("evm_snapshot");
  });
  afterEach(async () => {
    if (!FORK_RPC_URL) return;
    await revertTo(snapshotId);
  });

  it.skipIf(!FORK_RPC_URL)(
    "moves the pools toward the visitor's estimates",
    async () => {
      const {
        createLensQuoter,
        readPoolLiquidity,
        fetchExecutorState,
        gnosisRouterAddress,
        sDaiAdapterAbi,
        sDaiDepositRoute,
        tradeExecutorFactoryAddress,
        fetchSessionPools,
        optionPoolRefs,
        priceFromSqrtPriceX96,
        createPredictReader,
        planPredict,
        assertRoutes,
        NoRouteError,
      } = await load();

      const collateral = session.collateralToken;
      const router = gnosisRouterAddress(CHAIN_ID);
      const factory = tradeExecutorFactoryAddress(CHAIN_ID);
      const route = sDaiDepositRoute(collateral, CHAIN_ID);
      if (!router || !factory || !route) throw new Error("This chain is missing the Seer deployment.");

      // the owner needs the session's collateral before the flow can move any of it
      const minted = await wallet.sendTransaction({
        account,
        chain: gnosis,
        to: route.sDaiAdapter,
        value: DEPOSIT * 2n,
        data: encodeFunctionData({ abi: sDaiAdapterAbi, functionName: "depositXDAI", args: [account.address] }),
      });
      await client.waitForTransactionReceipt({ hash: minted });

      const { predicted } = await fetchExecutorState(client, { factory, owner: account.address });

      const child = session.children[0]!;
      const before = await readPoolLiquidity(client, optionPoolRefs(await fetchSessionPools(session.id), child.id).up!);
      const priceBefore = priceFromSqrtPriceX96(before.sqrtPriceX96, before.outcomeIsToken0);

      // one option, asked to move well above where the pool sits; an earlier run on this session may
      // already have moved it, so the target is set from the price now
      const option: PredictOption = {
        childMarket: child.id,
        underlying: child.underlyingToken,
        upToken: child.upToken,
        downToken: child.downToken,
        invalidToken: child.invalidToken,
        targetPriceWad: priceBefore + (10n ** 18n - priceBefore) / 2n,
      };

      const ctx: PredictCtx = {
        chainId: CHAIN_ID,
        owner: account.address,
        executor: predicted,
        factory,
        router,
        collateral,
        parentMarket: session.parentMarket,
        sDaiAdapter: route.sDaiAdapter,
        credits: null,
      };
      const snapshot: PredictSnapshot = {
        options: [option],
        deposit: DEPOSIT,
        depositNative: false,
        collateralIn: DEPOSIT,
        collateralBefore: 0n,
        creditsFromEoa: 0n,
        creditsToSpend: 0n,
        creditsAtStart: 0n,
        // read from the chain the way the run reads it when it starts
        collateralAtStart: await createPredictReader({ client, sessionId: session.id, collateral }).collateralBalance(
          ctx.executor,
        ),
        startedAt: Math.floor(Date.now() / 1000),
      };

      const reader = createPredictReader({ client, sessionId: session.id, collateral });
      const skipped: string[] = [];
      const deps = {
        reader,
        quoter: createLensQuoter(client, CHAIN_ID),
        slippageBps: 300,
        onSkip: (each: PredictOption, reason: unknown) => skipped.push(`${each.childMarket}: ${String(reason)}`),
      };
      const steps = planPredict(snapshot, deps);

      // the route check passes what the run will trade, and refuses dust for a wallet holding nothing
      await assertRoutes(ctx, snapshot, deps);
      const empty = { ...ctx, executor: "0x000000000000000000000000000000000000dEaD" as Address };
      const dust = { ...snapshot, deposit: 10n ** 15n, collateralIn: 10n ** 15n };
      await expect(assertRoutes(empty, dust, deps)).rejects.toBeInstanceOf(NoRouteError);

      const scope: LedgerScope = {
        owner: account.address,
        executor: predicted,
        manager: account.address,
        passThrough: [router, SWAPR_ROUTER, route.sDaiAdapter],
        collateral,
        wxdai: collateral,
        credits: collateral,
        options: [option],
      };
      const ledgerBefore = await readLedger(client, scope);
      const receipts: TransactionReceipt[] = [];
      const signed: Array<{ id: string; data: Hex }> = [];

      for (const step of steps) {
        if (await step.canSkip?.(ctx, snapshot)) continue;

        let tx;
        try {
          // `build` may answer synchronously, so this cannot be a rejection handler
          tx = await step.build(ctx, snapshot);
        } catch (reason) {
          throw new Error(`${step.id} could not be built: ${String(reason)}\n${skipped.join("\n")}`);
        }
        const hash = await wallet.sendTransaction({
          account,
          chain: gnosis,
          to: tx.to,
          data: tx.data,
          value: tx.value,
        });
        const receipt = await client.waitForTransactionReceipt({ hash });
        expect(receipt.status, `${step.id} reverted`).toBe("success");
        receipts.push(receipt);
        signed.push({ id: step.id, data: tx.data ?? "0x" });
      }
      await expectCoreMoneyKept({
        client,
        scope,
        before: ledgerBefore,
        after: await readLedger(client, scope),
        receipts,
        deposit: DEPOSIT,
        router,
        option,
        sent: signed,
      });

      const after = await readPoolLiquidity(client, optionPoolRefs(await fetchSessionPools(session.id), child.id).up!);
      const priceAfter = priceFromSqrtPriceX96(after.sqrtPriceX96, after.outcomeIsToken0);

      // the estimate is above the market, so the prediction has to have bid the UP token up
      expect(priceAfter).toBeGreaterThan(priceBefore);

      // and the executor is left holding the side it bought
      const held = await client.readContract({
        address: option.upToken,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [predicted],
      });
      expect(held).toBeGreaterThan(0n);
    },
    600_000,
  );
});

/** Hardhat's second and third accounts: one trades against the visitor, one provides liquidity. */
const RIVAL_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const LP_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as const;

/** Swapr's Algebra periphery on Gnosis: the router Lens routes every swap through, and its position manager. */
const SWAPR_ROUTER = "0xfFB643E73f280B97809A8b41f7232AB401a04ee1" as const;
const POSITION_MANAGER = "0x91fD594c46D8B01E62dBDeBed2401dde01817834" as const;

const SWAPR_ROUTER_ABI = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 limitSqrtPrice) params) payable returns (uint256 amountOut)",
]);
const POSITION_MANAGER_ABI = parseAbi([
  "function mint((address token0, address token1, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
]);
const TICK_SPACING_ABI = parseAbi(["function tickSpacing() view returns (int24)"]);
/** Algebra's pool event; amounts are the pool's deltas, so the input side includes the fee. */
const ALGEBRA_EVENTS_ABI = parseAbi([
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 price, uint128 liquidity, int24 tick)",
  "function globalState() view returns (uint160 price, int24 tick, uint16 fee, uint16 timepointIndex, uint8 communityFeeToken0, uint8 communityFeeToken1, bool unlocked)",
]);
/** Algebra quotes its fee in millionths of the input. */
const FEE_DENOMINATOR = 1_000_000n;

const WAD = 10n ** 18n;
const Q96 = 2n ** 96n;
/** How far each estimate sits from the pool it is placed against. */
const MOVE = (WAD * 8n) / 100n;
/** An estimate this close to its pool fills almost entirely at the cap, so the fee decides the average. */
const NEAR = (WAD * 5n) / 10_000n;
/** A concentrated position this many times the pool's own liquidity. */
const LP_MULTIPLE = 4n;
/** A rival's price move between quote and execution, in hundredths of a percent: inside the 1% slippage. */
const RIVAL_MOVE_BPS = 40n;

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

/** The highest block any test reached before rewinding; a rewound height is re-mined with a new hash. */
let highestBlock = 0n;

async function revertTo(snapshotId: string) {
  const head = BigInt(await rpc<string>("eth_blockNumber"));
  if (head > highestBlock) highestBlock = head;
  await rpc("evm_revert", [snapshotId]);
}

// The indexer reads a rewound height as a reorg; mining past every height reached lets it settle
// on empty blocks before anything else is seeded on the fork.
afterAll(async () => {
  if (!FORK_RPC_URL || highestBlock === 0n) return;
  const head = BigInt(await rpc<string>("eth_blockNumber"));
  if (head <= highestBlock) await rpc("hardhat_mine", [`0x${(highestBlock - head + 1n).toString(16)}`]);
});

/** Algebra's tick for a raw token1-per-token0 sqrt price. Floats are fine for a fixture's range. */
const tickAt = (sqrtPriceX96: bigint): number => Math.log((Number(sqrtPriceX96) / 2 ** 96) ** 2) / Math.log(1.0001);
const sqrtAtTick = (tick: number): bigint => BigInt(Math.round(Math.sqrt(1.0001 ** tick) * 2 ** 96));

describe("price limits on every swap leg, against a gnosis fork", () => {
  const owner = privateKeyToAccount(OWNER_KEY);
  let client: PublicClient;
  let wallet: WalletClient;
  let session: ForkSession;
  let snapshotId: string;
  let app: Awaited<ReturnType<typeof load>>;
  let tolerances: typeof import("../../oracle/tolerances");

  beforeAll(async () => {
    if (!FORK_RPC_URL) return;
    const transport = http(FORK_RPC_URL, { timeout: FORK_RPC_TIMEOUT_MS });
    client = createPublicClient({ chain: gnosis, transport }) as PublicClient;
    wallet = createWalletClient({ chain: gnosis, transport });
    await requireLensQuoter(FORK_RPC_URL);
    session = await newestSessionWithPools();
    app = await load();
    tolerances = await import("../../oracle/tolerances");
  }, 120_000);

  beforeEach(async () => {
    if (!FORK_RPC_URL) return;
    snapshotId = await rpc<string>("evm_snapshot");
    // other fork runs spend from these accounts outside any snapshot
    for (const key of [OWNER_KEY, RIVAL_KEY, LP_KEY]) {
      await rpc("hardhat_setBalance", [privateKeyToAccount(key).address, `0x${parseEther("10000").toString(16)}`]);
    }
  });

  afterEach(async () => {
    if (!FORK_RPC_URL) return;
    await revertTo(snapshotId);
  });

  type Side = "up" | "down";

  const send = async (from: PrivateKeyAccount, to: Address, data: Hex = "0x", value = 0n) => {
    // an Algebra mint's estimate can fall short of what the next block charges it, as a wallet's margin covers
    const gas = ((await client.estimateGas({ account: from, to, data, value })) * 3n) / 2n;
    const hash = await wallet.sendTransaction({ account: from, chain: gnosis, to, data, value, gas });
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${to} reverted`);
    return receipt;
  };

  const deadline = async () => (await client.getBlock()).timestamp + 3600n;

  /** Mints `xdai` worth of the session's collateral to `to`, and returns what landed. */
  async function fundCollateral(to: PrivateKeyAccount, xdai: bigint): Promise<bigint> {
    const route = app.sDaiDepositRoute(session.collateralToken, CHAIN_ID)!;
    const before = await balance(session.collateralToken, to.address);
    await send(
      to,
      route.sDaiAdapter,
      encodeFunctionData({ abi: app.sDaiAdapterAbi, functionName: "depositXDAI", args: [to.address] }),
      xdai,
    );
    return (await balance(session.collateralToken, to.address)) - before;
  }

  const balance = (token: Address, holder: Address) =>
    client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [holder] });

  async function approve(from: PrivateKeyAccount, token: Address, spender: Address, amount: bigint) {
    await send(from, token, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }));
  }

  /** Splits `amount` of `deposited` at `market`, the way the app does. */
  async function split(from: PrivateKeyAccount, deposited: Address, market: Address, amount: bigint) {
    const router = app.gnosisRouterAddress(CHAIN_ID)!;
    await approve(from, deposited, router, amount);
    await send(
      from,
      router,
      encodeFunctionData({
        abi: app.gnosisRouterAbi,
        functionName: "splitPosition",
        args: [session.collateralToken, market, amount],
      }),
    );
  }

  /** An account holding `amount` of every child's underlying, and of `child`'s outcome tokens when asked. */
  async function fundOutcomes(from: PrivateKeyAccount, child: ForkSession["children"][number], outcomes: boolean) {
    const collateral = await fundCollateral(from, parseEther("400"));
    await split(from, session.collateralToken, session.parentMarket, collateral);
    if (outcomes) await split(from, child.underlyingToken, child.id, collateral / 2n);
  }

  const optionFor = (child: ForkSession["children"][number], targetPriceWad: bigint): PredictOption => ({
    childMarket: child.id,
    underlying: child.underlyingToken,
    upToken: child.upToken,
    downToken: child.downToken,
    invalidToken: child.invalidToken,
    targetPriceWad,
  });

  // the indexer reads a rewind as a reorg and re-indexes what it rolled back, so a pool can be briefly absent
  const poolRef = async (child: ForkSession["children"][number], side: Side) => {
    const deadline = Date.now() + 60_000;
    for (;;) {
      const ref = app.optionPoolRefs(await app.fetchSessionPools(session.id), child.id)[side];
      if (ref) return ref;
      if (Date.now() > deadline) throw new Error(`${child.id} has no ${side} pool.`);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  };

  const poolPrice = async (child: ForkSession["children"][number], side: Side) => {
    const pool = await app.readPoolLiquidity(client, await poolRef(child, side));
    return app.priceFromSqrtPriceX96(pool.sqrtPriceX96, pool.outcomeIsToken0);
  };

  /** A child both of whose pools sit far enough from 0 and 1 for an estimate MOVE away either way. */
  async function tradeableChild() {
    for (const child of session.children) {
      const [up, down] = await Promise.all([poolPrice(child, "up"), poolPrice(child, "down")]);
      const roomy = (price: bigint) => price > (WAD * 3n) / 10n && price < (WAD * 7n) / 10n;
      if (roomy(up) && roomy(down)) return { child, up, down };
    }
    throw new Error("No child pool sits near 0.5. Run `yarn simulate:session:gnosis-fork --liquidity` first.");
  }

  /** `price` is within PRICE_TOLERANCE_TICKS of `target`, either way. */
  function expectAtTarget(price: bigint, target: bigint, what: string) {
    const ticks = BigInt(tolerances.PRICE_TOLERANCE_TICKS);
    const [up, down] = [10_001n ** ticks, 10_000n ** ticks];
    expect(price, `${what} ended past its target ${target}`).toBeLessThanOrEqual((target * up) / down);
    expect(price, `${what} ended short of its target ${target}`).toBeGreaterThanOrEqual((target * down) / up);
  }

  /**
   * A position `LP_MULTIPLE` times as deep as the pool, from just behind the price to halfway
   * to `target`, so the pool thins out again between there and the target.
   */
  async function concentrate(child: ForkSession["children"][number], side: Side, target: bigint) {
    const lp = privateKeyToAccount(LP_KEY);
    await fundOutcomes(lp, child, true);

    const ref = await poolRef(child, side);
    const pool = await app.readPoolLiquidity(client, ref);
    const spacing = await client.readContract({
      address: ref.address,
      abi: TICK_SPACING_ABI,
      functionName: "tickSpacing",
    });
    const sqrtTarget = app.sqrtPriceX96FromPrice(target, ref.outcomeIsToken0);
    const current = tickAt(pool.sqrtPriceX96);
    const halfway = (current + tickAt(sqrtTarget)) / 2;
    const behind = current - Math.sign(halfway - current) * 2 * spacing;

    const tickLower = Math.floor(Math.min(behind, halfway) / spacing) * spacing;
    const tickUpper = Math.ceil(Math.max(behind, halfway) / spacing) * spacing;
    const [sa, sb, sc] = [sqrtAtTick(tickLower), sqrtAtTick(tickUpper), pool.sqrtPriceX96];
    const liquidity = pool.liquidity * LP_MULTIPLE;
    const amount0 = (((liquidity * Q96 * (sb - sc)) / (sb * sc)) * 102n) / 100n;
    const amount1 = (((liquidity * (sc - sa)) / Q96) * 102n) / 100n;

    const outcome = side === "up" ? child.upToken : child.downToken;
    const [token0, token1] = ref.outcomeIsToken0 ? [outcome, child.underlyingToken] : [child.underlyingToken, outcome];
    await approve(lp, token0, POSITION_MANAGER, amount0);
    await approve(lp, token1, POSITION_MANAGER, amount1);
    await send(
      lp,
      POSITION_MANAGER,
      encodeFunctionData({
        abi: POSITION_MANAGER_ABI,
        functionName: "mint",
        args: [
          {
            token0,
            token1,
            tickLower,
            tickUpper,
            amount0Desired: amount0,
            amount1Desired: amount1,
            amount0Min: 0n,
            amount1Min: 0n,
            recipient: lp.address,
            deadline: await deadline(),
          },
        ],
      }),
    );

    const deeper = await app.readPoolLiquidity(client, ref);
    expect(deeper.liquidity, "the position covers the price").toBeGreaterThan(pool.liquidity * 3n);
  }

  /** Another account buys `side` until its pool has moved RIVAL_MOVE_BPS further. */
  async function rivalBuy(child: ForkSession["children"][number], side: Side) {
    const rival = privateKeyToAccount(RIVAL_KEY);
    await fundOutcomes(rival, child, false);

    const ref = await poolRef(child, side);
    const pool = await app.readPoolLiquidity(client, ref);
    const price = app.priceFromSqrtPriceX96(pool.sqrtPriceX96, ref.outcomeIsToken0);
    const limit = app.sqrtPriceX96FromPrice((price * (10_000n + RIVAL_MOVE_BPS)) / 10_000n, ref.outcomeIsToken0);
    const amountIn = await balance(child.underlyingToken, rival.address);

    await approve(rival, child.underlyingToken, SWAPR_ROUTER, amountIn);
    await send(
      rival,
      SWAPR_ROUTER,
      encodeFunctionData({
        abi: SWAPR_ROUTER_ABI,
        functionName: "exactInputSingle",
        args: [
          {
            tokenIn: child.underlyingToken,
            tokenOut: side === "up" ? child.upToken : child.downToken,
            recipient: rival.address,
            deadline: await deadline(),
            amountIn,
            amountOutMinimum: 0n,
            limitSqrtPrice: limit,
          },
        ],
      }),
    );

    expect(await poolPrice(child, side), "the rival moved the pool").toBeGreaterThan(price);
  }

  /** Runs the app's own steps for one estimate; `beforeSend` runs between quoting a batch and sending it. */
  async function predict(option: PredictOption, deposit: bigint, beforeSend?: () => Promise<void>) {
    const funded = await fundCollateral(owner, deposit * 2n);
    expect(funded).toBeGreaterThanOrEqual(deposit);

    const router = app.gnosisRouterAddress(CHAIN_ID)!;
    const factory = app.tradeExecutorFactoryAddress(CHAIN_ID)!;
    const route = app.sDaiDepositRoute(session.collateralToken, CHAIN_ID)!;
    const { predicted } = await app.fetchExecutorState(client, { factory, owner: owner.address });
    const ctx: PredictCtx = {
      chainId: CHAIN_ID,
      owner: owner.address,
      executor: predicted,
      factory,
      router,
      collateral: session.collateralToken,
      parentMarket: session.parentMarket,
      sDaiAdapter: route.sDaiAdapter,
      credits: null,
    };
    const snapshot: PredictSnapshot = {
      options: [option],
      deposit,
      depositNative: false,
      collateralIn: deposit,
      collateralBefore: 0n,
      creditsFromEoa: 0n,
      creditsToSpend: 0n,
      creditsAtStart: 0n,
      // read from the chain the way the run reads it when it starts
      collateralAtStart: await app
        .createPredictReader({ client, sessionId: session.id, collateral: session.collateralToken })
        .collateralBalance(ctx.executor),
      startedAt: Math.floor(Date.now() / 1000),
    };
    const deps = {
      reader: app.createPredictReader({ client, sessionId: session.id, collateral: session.collateralToken }),
      quoter: app.createLensQuoter(client, CHAIN_ID),
      slippageBps: tolerances.SLIPPAGE_BPS,
    };

    const scope: LedgerScope = {
      owner: owner.address,
      executor: predicted,
      manager: owner.address,
      passThrough: [router, SWAPR_ROUTER, route.sDaiAdapter],
      collateral: session.collateralToken,
      wxdai: session.collateralToken,
      credits: session.collateralToken,
      options: [option],
    };
    const before = await readLedger(client, scope);

    const sent: Array<{ id: string; status: string; data: Hex; logs: Log[] }> = [];
    const receipts: TransactionReceipt[] = [];
    for (const step of app.planPredict(snapshot, deps)) {
      if (await step.canSkip?.(ctx, snapshot)) continue;
      const tx = await step.build(ctx, snapshot);
      if (step.id.startsWith("predict-")) await beforeSend?.();

      let status = "success";
      let logs: Log[] = [];
      try {
        const receipt = await send(owner, tx.to, tx.data, tx.value ?? 0n);
        receipts.push(receipt);
        logs = receipt.logs;
      } catch (reason) {
        status = `reverted: ${String(reason).split("\n")[0]}`;
      }
      sent.push({ id: step.id, status, data: tx.data ?? "0x", logs });
    }

    if (sent.every((each) => each.status === "success")) {
      const after = await readLedger(client, scope);
      await expectCoreMoneyKept({ client, scope, before, after, receipts, deposit, router, option, sent });
    }
    return sent;
  }

  it.skipIf(!FORK_RPC_URL)(
    "puts a limit at the target on every buy and sell leg it signs",
    async () => {
      const { child, up } = await tradeableChild();

      for (const target of [up + MOVE, up - MOVE]) {
        const option = optionFor(child, target);
        const sideOf = (token: Address): Side | null =>
          token.toLowerCase() === child.upToken.toLowerCase()
            ? "up"
            : token.toLowerCase() === child.downToken.toLowerCase()
              ? "down"
              : null;

        const sent = await predict(option, parseEther("100"));
        const batch = sent.find((each) => each.id.startsWith("predict-"))!;
        const inner = decodeFunctionData({ abi: app.tradeExecutorAbi, data: batch.data });
        if (inner.functionName !== "batchExecute") throw new Error(`Expected batchExecute, got ${inner.functionName}`);

        const legs = inner.args[0]
          .filter((call) => call.to.toLowerCase() === SWAPR_ROUTER.toLowerCase())
          .map((call) => decodeFunctionData({ abi: SWAPR_ROUTER_ABI, data: call.data }).args[0]);
        const sides = legs.map((leg) => sideOf(leg.tokenOut) ?? sideOf(leg.tokenIn));
        expect([...sides].sort(), "one buy and one sell").toEqual(["down", "up"]);

        for (const [index, leg] of legs.entries()) {
          const side = sides[index]!;
          const ref = await poolRef(child, side);
          const sideTarget = side === "up" ? target : WAD - target;
          expect(leg.limitSqrtPrice, `the ${side} leg carries a limit`).not.toBe(0n);
          expectAtTarget(
            app.priceFromSqrtPriceX96(leg.limitSqrtPrice, ref.outcomeIsToken0),
            sideTarget,
            `the ${side} limit`,
          );
        }

        await revertTo(snapshotId);
        snapshotId = await rpc<string>("evm_snapshot");
      }
    },
    600_000,
  );

  it.skipIf(!FORK_RPC_URL)(
    "stops an UP buy and a DOWN sell at the target through a concentrated position",
    async () => {
      const { child, up } = await tradeableChild();
      const target = up + MOVE;
      await concentrate(child, "up", target);
      await concentrate(child, "down", WAD - target);

      const sent = await predict(optionFor(child, target), parseEther("300"));

      expect(
        sent.map((each) => each.status),
        "every step executes",
      ).toEqual(sent.map(() => "success"));
      expectAtTarget(await poolPrice(child, "up"), target, "the UP pool");
      expectAtTarget(await poolPrice(child, "down"), WAD - target, "the DOWN pool");
    },
    600_000,
  );

  it.skipIf(!FORK_RPC_URL)(
    "stops a DOWN buy and an UP sell at the target through a concentrated position",
    async () => {
      const { child, up } = await tradeableChild();
      const target = up - MOVE;
      await concentrate(child, "down", WAD - target);
      await concentrate(child, "up", target);

      const sent = await predict(optionFor(child, target), parseEther("300"));

      expect(
        sent.map((each) => each.status),
        "every step executes",
      ).toEqual(sent.map(() => "success"));
      expectAtTarget(await poolPrice(child, "down"), WAD - target, "the DOWN pool");
      expectAtTarget(await poolPrice(child, "up"), target, "the UP pool");
    },
    600_000,
  );

  /** The pool's current dynamic fee, in millionths. */
  const poolFee = async (child: ForkSession["children"][number], side: Side) => {
    const [, , fee] = await client.readContract({
      address: (await poolRef(child, side)).address,
      abi: ALGEBRA_EVENTS_ABI,
      functionName: "globalState",
    });
    return BigInt(fee);
  };

  /** One leg's fill from its pool's Swap events: collateral per outcome token, fee included, in WAD. */
  async function legFill(child: ForkSession["children"][number], side: Side, logs: Log[]) {
    const ref = await poolRef(child, side);
    const swaps = parseEventLogs({ abi: ALGEBRA_EVENTS_ABI, eventName: "Swap", logs }).filter(
      (each) => each.address.toLowerCase() === ref.address.toLowerCase(),
    );
    expect(swaps.length, `the ${side} leg swapped`).toBeGreaterThan(0);
    const amount0 = swaps.reduce((sum, each) => sum + each.args.amount0, 0n);
    const amount1 = swaps.reduce((sum, each) => sum + each.args.amount1, 0n);
    const [outcome, underlying] = ref.outcomeIsToken0 ? [amount0, amount1] : [amount1, amount0];
    // pool deltas: positive flows into the pool, so a buy takes outcome tokens out
    const isBuy = outcome < 0n;
    const outcomeMoved = isBuy ? -outcome : outcome;
    const underlyingMoved = isBuy ? underlying : -underlying;
    return { isBuy, average: (underlyingMoved * WAD) / outcomeMoved };
  }

  it.skipIf(!FORK_RPC_URL)(
    "keeps the fee-inclusive average of a buy and a sell leg within the target by no more than the pool fee",
    async () => {
      const { child, up, down } = await tradeableChild();
      const ticks = BigInt(tolerances.PRICE_TOLERANCE_TICKS);
      const [tickUp, tickDown] = [10_001n ** ticks, 10_000n ** ticks];
      const scenarios = [
        { what: "an UP buy", near: "up" as Side, isBuy: true, target: up + NEAR },
        { what: "a DOWN sell", near: "down" as Side, isBuy: false, target: WAD - (down - NEAR) },
      ];

      for (const { what, near, isBuy, target } of scenarios) {
        const capOf = (side: Side) => (side === "up" ? target : WAD - target);
        await concentrate(child, "up", capOf("up"));
        await concentrate(child, "down", capOf("down"));

        const fees = { up: 0n, down: 0n };
        const recordFees = async () => {
          for (const side of ["up", "down"] as const) {
            const fee = await poolFee(child, side);
            if (fee > fees[side]) fees[side] = fee;
          }
        };
        const sent = await predict(optionFor(child, target), parseEther("300"), recordFees);
        await recordFees();

        expect(
          sent.map((each) => each.status),
          `${what}: every step executes`,
        ).toEqual(sent.map(() => "success"));
        const logs = sent.filter((each) => each.id.startsWith("predict-")).flatMap((each) => each.logs);

        const fill = await legFill(child, near, logs);
        expect(fill.isBuy, `${what} is the leg the scenario places next to its cap`).toBe(isBuy);

        const cap = capOf(near);
        const fee = fees[near];
        const detail = `${what} averaged ${fill.average} against cap ${cap} with fee ${fee}`;
        if (isBuy) {
          // a buy pays at most the cap before the fee, so at most cap / (1 - fee) with it
          const bound = (cap * tickUp * FEE_DENOMINATOR) / (tickDown * (FEE_DENOMINATOR - fee));
          expect(fill.average, detail).toBeLessThanOrEqual(bound);
        } else {
          // a sell receives at least the cap before the fee, so at least cap * (1 - fee) with it
          const bound = (cap * tickDown * (FEE_DENOMINATOR - fee)) / (tickUp * FEE_DENOMINATOR);
          expect(fill.average, detail).toBeGreaterThanOrEqual(bound);
        }

        await revertTo(snapshotId);
        snapshotId = await rpc<string>("evm_snapshot");
      }
    },
    600_000,
  );

  it.skipIf(!FORK_RPC_URL)(
    "keeps an UP buy at or below the target when a rival buys first",
    async () => {
      const { child, up } = await tradeableChild();
      const target = up + MOVE;

      const sent = await predict(optionFor(child, target), parseEther("100"), () => rivalBuy(child, "up"));

      const end = await poolPrice(child, "up");
      expect(
        end,
        `UP ended past ${target}; steps: ${JSON.stringify(sent.map((each) => each.status))}`,
      ).toBeLessThanOrEqual(target);
    },
    600_000,
  );

  it.skipIf(!FORK_RPC_URL)(
    "keeps a DOWN buy at or below the target when a rival buys first",
    async () => {
      const { child, up } = await tradeableChild();
      const target = up - MOVE;

      const sent = await predict(optionFor(child, target), parseEther("100"), () => rivalBuy(child, "down"));

      const end = await poolPrice(child, "down");
      expect(
        end,
        `DOWN ended past ${WAD - target}; steps: ${JSON.stringify(sent.map((each) => each.status))}`,
      ).toBeLessThanOrEqual(WAD - target);
    },
    600_000,
  );
});

/**
 * M1 to M3 for a run with no credits that every step of landed: the owner paid the sDAI shown and
 * gas, the trade wallet split all of it, nothing stayed where money only passes, and the option
 * received at least what each leg's minimum promised.
 */
async function expectCoreMoneyKept(args: {
  client: PublicClient;
  scope: LedgerScope;
  before: Ledger;
  after: Ledger;
  receipts: TransactionReceipt[];
  deposit: bigint;
  router: Address;
  option: PredictOption;
  sent: Array<{ id: string; data: Hex }>;
}) {
  const { client, scope, before, after, receipts, deposit, router, option } = args;
  const { owner, executor, collateral } = scope;

  expect(moved(before, after, owner, collateral), "sDAI from the wallet").toBe(-deposit);
  expect(moved(before, after, owner, "native"), "the owner paid only gas in xDAI").toBe(-gasPaid(receipts));
  expect(moved(before, after, executor, collateral), "the trade wallet split all it was given").toBe(0n);
  expect(moved(before, after, executor, "native")).toBe(0n);
  for (const holder of scope.passThrough) {
    for (const token of tokensOf(scope))
      expect(moved(before, after, holder, token), `${holder} kept ${token}`).toBe(0n);
    expect(moved(before, after, holder, "native"), `${holder} kept xDAI`).toBe(0n);
  }
  expect(await outsideRecipients(client, receipts, scope), "paid to an outside account").toEqual([]);

  const batch = args.sent.find((each) => each.id.startsWith("predict-"))!;
  const decoded = decodeFunctionData({
    abi: parseAbi(["function batchExecute((address to, bytes data)[] calls)"]),
    data: batch.data,
  });
  const legs = signedOptions(decoded.args[0], [option], { gnosisRouter: router, swaprRouter: SWAPR_ROUTER }).get(
    option.childMarket,
  )!;
  expect(legs.childSplit, "the option splits what the parent split gave it").toBe(
    before.tokens.get(executor)!.get(option.underlying)! + deposit,
  );
  for (const token of [option.upToken, option.downToken]) {
    const floor =
      legs.childSplit -
      (legs.sold.get(token.toLowerCase() as Address) ?? 0n) -
      legs.merge +
      (legs.boughtAtLeast.get(token.toLowerCase() as Address) ?? 0n);
    expect(
      moved(before, after, executor, token),
      `${token} received at least the plan's minimum`,
    ).toBeGreaterThanOrEqual(floor);
  }
  expect(moved(before, after, executor, option.invalidToken)).toBe(legs.childSplit - legs.merge);
}

/** Hardhat's fourth account, whose trade wallet no other fork test touches. */
const STALE_OWNER_KEY = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" as const;

describe("the split amount when the cached trade-wallet balance is stale, against a gnosis fork", () => {
  const owner = privateKeyToAccount(STALE_OWNER_KEY);
  let client: PublicClient;
  let wallet: WalletClient;
  let session: ForkSession;
  let snapshotId: string;
  let app: Awaited<ReturnType<typeof load>>;

  beforeAll(async () => {
    if (!FORK_RPC_URL) return;
    const transport = http(FORK_RPC_URL, { timeout: FORK_RPC_TIMEOUT_MS });
    client = createPublicClient({ chain: gnosis, transport }) as PublicClient;
    wallet = createWalletClient({ chain: gnosis, transport });
    await requireLensQuoter(FORK_RPC_URL);
    session = await newestSessionWithPools();
    app = await load();
  }, 120_000);

  beforeEach(async () => {
    if (!FORK_RPC_URL) return;
    snapshotId = await rpc<string>("evm_snapshot");
  });

  afterEach(async () => {
    if (!FORK_RPC_URL) return;
    await revertTo(snapshotId);
  });

  const send = async (to: Address, data: Hex = "0x", value = 0n) => {
    const hash = await wallet.sendTransaction({ account: owner, chain: gnosis, to, data, value });
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${to} reverted`);
    return hash;
  };

  const collateralOf = (holder: Address, blockNumber?: bigint) =>
    client.readContract({
      address: session.collateralToken,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [holder],
      ...(blockNumber === undefined ? {} : { blockNumber }),
    });

  /** The collateral a predict transaction splits at the session's parent. */
  function parentSplit(data: Hex): bigint {
    const decoded = decodeFunctionData({ abi: app.tradeExecutorAbi, data });
    if (decoded.functionName !== "batchExecute") throw new Error(`Expected batchExecute, got ${decoded.functionName}`);
    for (const call of decoded.args[0]) {
      if (call.to.toLowerCase() !== app.gnosisRouterAddress(CHAIN_ID)!.toLowerCase()) continue;
      const inner = decodeFunctionData({ abi: app.gnosisRouterAbi, data: call.data });
      if (
        inner.functionName === "splitPosition" &&
        inner.args[1].toLowerCase() === session.parentMarket.toLowerCase()
      ) {
        return inner.args[2];
      }
    }
    throw new Error("The predict transaction splits nothing at the parent.");
  }

  /** An option one MOVE above a child's UP pool, which sits far enough from 0 and 1 to take it. */
  async function roomyOption(): Promise<PredictOption> {
    for (const child of session.children) {
      const ref = app.optionPoolRefs(await app.fetchSessionPools(session.id), child.id).up;
      if (!ref) continue;
      const pool = await app.readPoolLiquidity(client, ref);
      const up = app.priceFromSqrtPriceX96(pool.sqrtPriceX96, pool.outcomeIsToken0);
      if (up > (WAD * 3n) / 10n && up < (WAD * 7n) / 10n) {
        return {
          childMarket: child.id,
          underlying: child.underlyingToken,
          upToken: child.upToken,
          downToken: child.downToken,
          invalidToken: child.invalidToken,
          targetPriceWad: up + MOVE,
        };
      }
    }
    throw new Error("No child pool sits near 0.5. Run `yarn simulate:session:gnosis-fork --liquidity` first.");
  }

  /**
   * Puts `topUp` collateral in the owner's trade wallet, then runs the app's driver as the popup
   * would with the trade wallet cached at `cached(real)` and `asked(real)` collateral asked for.
   */
  async function predictWithCache(args: {
    native: boolean;
    topUp: bigint;
    cached: (real: bigint) => bigint;
    asked: (real: bigint) => bigint;
  }) {
    const route = app.sDaiDepositRoute(session.collateralToken, CHAIN_ID)!;
    const router = app.gnosisRouterAddress(CHAIN_ID)!;
    const factory = app.tradeExecutorFactoryAddress(CHAIN_ID)!;
    const { predicted } = await app.fetchExecutorState(client, { factory, owner: owner.address });

    await send(
      route.sDaiAdapter,
      encodeFunctionData({ abi: app.sDaiAdapterAbi, functionName: "depositXDAI", args: [owner.address] }),
      parseEther("100"),
    );
    await send(
      session.collateralToken,
      encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [predicted, args.topUp] }),
    );

    const real = await collateralOf(predicted);
    const rate = await client.readContract({
      address: route.sDai,
      abi: parseAbi(["function convertToAssets(uint256) view returns (uint256)"]),
      functionName: "convertToAssets",
      args: [WAD],
    });
    const tokenPerCollateralWad = args.native ? rate : undefined;
    const amount = args.native ? (args.asked(real) * rate) / WAD : args.asked(real);
    const ownWallet = args.native
      ? await client.getBalance({ address: owner.address })
      : await collateralOf(owner.address);

    // what the popup shows, worked out from the cached balance as usePredictFunding does
    const funding = planFunding({ amount, ownWallet, tradeWallet: args.cached(real), tokenPerCollateralWad });
    const snapshot: PredictRequest = {
      options: [await roomyOption()],
      deposit: funding.deposit,
      depositNative: args.native,
      collateralIn: funding.collateralIn,
      collateralBefore: args.cached(real),
      creditsFromEoa: 0n,
      creditsToSpend: 0n,
      startedAt: Math.floor(Date.now() / 1000),
    };
    const ctx: PredictCtx = {
      chainId: CHAIN_ID,
      owner: owner.address,
      executor: predicted,
      factory,
      router,
      collateral: session.collateralToken,
      parentMarket: session.parentMarket,
      sDaiAdapter: route.sDaiAdapter,
      credits: null,
    };

    const sent: Array<{ tx: FlowTx; hash: Hash }> = [];
    const driver = app.createPredictRun({
      gateway: createViemTxGateway({
        client,
        sendTransaction: async (tx) => {
          const hash = await wallet.sendTransaction({
            account: owner,
            chain: gnosis,
            to: tx.to,
            data: tx.data,
            value: tx.value,
          });
          sent.push({ tx, hash });
          return hash;
        },
      }),
      reader: app.createPredictReader({ client, sessionId: session.id, collateral: session.collateralToken }),
      quoter: app.createLensQuoter(client, CHAIN_ID),
      slippageBps: 300,
      flowId: `predict-stale-cache-${Date.now()}`,
      ctx: () => ctx,
      snapshot: () => snapshot,
    });

    try {
      driver.start();
      await vi.waitFor(() => expect(["halted", "complete"]).toContain(driver.getProgress().stage), {
        timeout: 300_000,
        interval: 250,
      });
      expect(driver.getProgress().stage, JSON.stringify(driver.getProgress().failure)).toBe("complete");
    } finally {
      driver.dispose();
    }

    // what each deposit put in the trade wallet, read from the chain either side of its block
    let added = 0n;
    for (const { tx, hash } of sent) {
      const to = tx.to.toLowerCase();
      if (to !== session.collateralToken.toLowerCase() && to !== route.sDaiAdapter.toLowerCase()) continue;
      const { blockNumber } = await client.getTransactionReceipt({ hash });
      added += (await collateralOf(predicted, blockNumber)) - (await collateralOf(predicted, blockNumber - 1n));
    }

    const predict = sent.find(({ tx }) => tx.to.toLowerCase() === predicted.toLowerCase());
    if (!predict) throw new Error("No predict transaction was sent.");

    return { split: parentSplit(predict.tx.data!), added, shown: funding.fromTradeWallet };
  }

  const cases = [
    ["an xDAI deposit, cache 2 below the real balance", true, parseEther("5"), (real: bigint) => real - WAD * 2n],
    ["an xDAI deposit, cache at 0", true, parseEther("15"), () => 0n],
    ["an sDAI deposit, cache 2 below the real balance", false, parseEther("5"), (real: bigint) => real - WAD * 2n],
    ["an sDAI deposit, cache at 0", false, parseEther("15"), () => 0n],
  ] as const;

  for (const [name, native, topUp, cached] of cases) {
    it.skipIf(!FORK_RPC_URL)(
      `splits what the deposit added plus the trade-wallet share shown (${name})`,
      async () => {
        // the low cache asks for more than the wallet holds, the zero cache for less, as the verifier did
        const asked =
          topUp === parseEther("5") ? (real: bigint) => real + parseEther("4.5698") : (real: bigint) => real - WAD * 5n;

        const { split, added, shown } = await predictWithCache({ native, topUp, cached, asked });

        expect(split, `added ${added}, shown from the trade wallet ${shown}`).toBe(added + shown);
      },
      600_000,
    );
  }
});

/** Gnosis' Foresight credits governor, an admin of the token and the manager's governor. */
const CREDITS_GOVERNOR = "0x4EDCA105188a0783Ab3A6f09c50567D1E3F8591D" as const;
const CREDITS_ADMIN_ABI = parseAbi([
  "function governor() view returns (address)",
  "function mint(address to, uint256 amount)",
  "function sweepTokens(address token)",
]);
const VAULT_ABI = parseAbi([
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function previewDeposit(uint256 assets) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
]);
const MANAGER_EXECUTE_ABI = parseAbi(["function execute(address to, bytes data, uint256 amount, address outputToken)"]);
const WXDAI_WITHDRAW_ABI = parseAbi(["function withdraw(uint256 wad)"]);
const POOL_FEE_ABI = parseAbi([
  "function globalState() view returns (uint160 price, int24 tick, uint16 fee, uint16 timepointIndex, uint8 communityFeeToken0, uint8 communityFeeToken1, bool unlocked)",
]);

/** Hardhat's sixth to tenth accounts: each scenario starts from a wallet no other test has used. */
const FRESH_KEYS = [
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
  "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
  "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356",
  "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97",
  "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6",
] as const;

/** How far each scenario's estimates sit from their pools, small enough for the amounts below to reach. */
const NUDGE = (WAD * 2n) / 100n;

type Child = ForkSession["children"][number];

interface Scenario {
  key: Hex;
  pay: "collateral" | "native";
  /** In the token paid with. */
  amount: bigint;
  /** sDAI minted to the owner first, as xDAI paid to the adapter. */
  walletCollateral?: bigint;
  credits?: { wallet?: bigint; tradeWallet?: bigint };
  /** The credits tick; on whenever the owner holds credits, as the popup's default. */
  useCredits?: boolean;
  /** The options and their estimates, picked against the pools as they are. */
  options: (children: Array<{ child: Child; up: bigint; down: bigint }>) => PredictOption[];
  /** Runs once, after the first batch is quoted and before it is sent. */
  beforeBatch?: () => Promise<void>;
  /** Sends with this gas rather than an estimate, so a batch meant to revert reaches the chain. */
  gas?: bigint;
}

interface ScenarioRun {
  ctx: PredictCtx;
  funding: Funding;
  request: PredictRequest;
  options: PredictOption[];
  /** Every child of the session, the way the ledger reads them. */
  children: PredictOption[];
  before: Ledger;
  after: Ledger;
  sent: Array<{ stepId: string; tx: FlowTx; receipt: TransactionReceipt }>;
  progress: ReturnType<import("../../run/types").PredictDriver["getProgress"]>;
  driver: import("../../run/types").PredictDriver;
  /** Each option's pool prices and fees as the run started. */
  start: Map<Address, { up: bigint; down: bigint; fees: { up: bigint; down: bigint } }>;
}

describe("money kept by every predict run, against a gnosis fork", () => {
  let client: PublicClient;
  let wallet: WalletClient;
  let session: ForkSession;
  let snapshotId: string;
  let app: Awaited<ReturnType<typeof load>>;
  let tolerances: typeof import("../../oracle/tolerances");
  let route: NonNullable<ReturnType<Awaited<ReturnType<typeof load>>["creditsRoute"]>>;
  let fresh = 0;

  beforeAll(async () => {
    if (!FORK_RPC_URL) return;
    const transport = http(FORK_RPC_URL, { timeout: FORK_RPC_TIMEOUT_MS });
    client = createPublicClient({ chain: gnosis, transport }) as PublicClient;
    wallet = createWalletClient({ chain: gnosis, transport });
    await requireLensQuoter(FORK_RPC_URL);
    session = await newestSessionWithPools();
    app = await load();
    tolerances = await import("../../oracle/tolerances");
    const found = app.creditsRoute(session.collateralToken, CHAIN_ID);
    if (!found) throw new Error("The session's collateral is not the sDAI Foresight credits spend.");
    route = found;

    // the fixtures act as the governor; a changed governor would make every grant below fail
    const governor = await client.readContract({
      address: route.token,
      abi: CREDITS_ADMIN_ABI,
      functionName: "governor",
    });
    expect(governor.toLowerCase()).toBe(CREDITS_GOVERNOR.toLowerCase());
    const accounts = await rpc<string[]>("eth_accounts");
    for (const key of FRESH_KEYS) {
      expect(accounts.map((each) => each.toLowerCase())).toContain(privateKeyToAccount(key).address.toLowerCase());
    }
  }, 120_000);

  beforeEach(async () => {
    if (!FORK_RPC_URL) return;
    snapshotId = await rpc<string>("evm_snapshot");
    for (const address of [...FRESH_KEYS.map((key) => privateKeyToAccount(key).address), CREDITS_GOVERNOR]) {
      await rpc("hardhat_setBalance", [address, `0x${parseEther("10000").toString(16)}`]);
    }
  });

  afterEach(async () => {
    if (!FORK_RPC_URL) return;
    await revertTo(snapshotId);
  });

  const nextKey = () => FRESH_KEYS[fresh++ % FRESH_KEYS.length]!;

  const balance = (token: Address, holder: Address, blockNumber?: bigint) =>
    client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [holder],
      ...(blockNumber === undefined ? {} : { blockNumber }),
    });

  async function sendFrom(from: PrivateKeyAccount, to: Address, data: Hex = "0x", value = 0n) {
    const gas = ((await client.estimateGas({ account: from, to, data, value })) * 3n) / 2n;
    const hash = await wallet.sendTransaction({ account: from, chain: gnosis, to, data, value, gas });
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${to} reverted`);
  }

  /** Sends `data` to `to` as the credits governor, impersonated for the one call. */
  async function asGovernor(to: Address, data: Hex) {
    await rpc("hardhat_impersonateAccount", [CREDITS_GOVERNOR]);
    try {
      const hash = await wallet.sendTransaction({ account: CREDITS_GOVERNOR, chain: gnosis, to, data });
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`the governor's call to ${to} reverted`);
    } finally {
      await rpc("hardhat_stopImpersonatingAccount", [CREDITS_GOVERNOR]);
    }
  }

  const grantCredits = (to: Address, amount: bigint) =>
    asGovernor(route.token, encodeFunctionData({ abi: CREDITS_ADMIN_ABI, functionName: "mint", args: [to, amount] }));

  /** Sends all of the manager's sDAI to the governor. */
  const drainManager = () =>
    asGovernor(
      route.manager,
      encodeFunctionData({ abi: CREDITS_ADMIN_ABI, functionName: "sweepTokens", args: [session.collateralToken] }),
    );

  /** Hands the manager `amount` of the sDAI a drain sent the governor. */
  const refillManager = (amount: bigint) =>
    asGovernor(
      session.collateralToken,
      encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [route.manager, amount] }),
    );

  const asOption = (child: Child, targetPriceWad = WAD / 2n): PredictOption => ({
    childMarket: child.id,
    underlying: child.underlyingToken,
    upToken: child.upToken,
    downToken: child.downToken,
    invalidToken: child.invalidToken,
    targetPriceWad,
  });

  const poolRef = async (childMarket: Address, side: "up" | "down") => {
    const deadline = Date.now() + 60_000;
    for (;;) {
      const ref = app.optionPoolRefs(await app.fetchSessionPools(session.id), childMarket)[side];
      if (ref) return ref;
      if (Date.now() > deadline) throw new Error(`${childMarket} has no ${side} pool.`);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  };

  const poolPrice = async (childMarket: Address, side: "up" | "down") => {
    const ref = await poolRef(childMarket, side);
    const pool = await app.readPoolLiquidity(client, ref);
    return app.priceFromSqrtPriceX96(pool.sqrtPriceX96, pool.outcomeIsToken0);
  };

  const poolFee = async (childMarket: Address, side: "up" | "down") => {
    const [, , fee] = await client.readContract({
      address: (await poolRef(childMarket, side)).address,
      abi: POOL_FEE_ABI,
      functionName: "globalState",
    });
    return BigInt(fee);
  };

  /** Every child whose two pools sit between 0.15 and 0.85, with where they sit. */
  async function roomyChildren() {
    const roomy: Array<{ child: Child; up: bigint; down: bigint }> = [];
    for (const child of session.children) {
      const refs = app.optionPoolRefs(await app.fetchSessionPools(session.id), child.id);
      if (!refs.up || !refs.down) continue;
      const [up, down] = [await poolPrice(child.id, "up"), await poolPrice(child.id, "down")];
      const inside = (price: bigint) => price > (WAD * 15n) / 100n && price < (WAD * 85n) / 100n;
      if (inside(up) && inside(down)) roomy.push({ child, up, down });
    }
    if (roomy.length === 0)
      throw new Error("No child pool sits near 0.5. Run `yarn simulate:session:gnosis-fork --liquidity`.");
    return roomy;
  }

  /** `price` is within PRICE_TOLERANCE_TICKS of `target`, either way. */
  function expectAtTarget(price: bigint, target: bigint, what: string) {
    const ticks = BigInt(tolerances.PRICE_TOLERANCE_TICKS);
    const [up, down] = [10_001n ** ticks, 10_000n ** ticks];
    expect(price, `${what} ended above its target ${target}`).toBeLessThanOrEqual((target * up) / down);
    expect(price, `${what} ended below its target ${target}`).toBeGreaterThanOrEqual((target * down) / up);
  }

  /**
   * Funds a fresh owner as the scenario says, works out the funding as the popup does, and runs
   * the app's driver to the end with the ledger read either side.
   */
  async function runScenario(scenario: Scenario, owner = privateKeyToAccount(scenario.key)): Promise<ScenarioRun> {
    const factory = app.tradeExecutorFactoryAddress(CHAIN_ID)!;
    const router = app.gnosisRouterAddress(CHAIN_ID)!;
    const deposit = app.sDaiDepositRoute(session.collateralToken, CHAIN_ID)!;
    const { predicted: executor } = await app.fetchExecutorState(client, { factory, owner: owner.address });

    if (scenario.walletCollateral) {
      await sendFrom(
        owner,
        deposit.sDaiAdapter,
        encodeFunctionData({ abi: app.sDaiAdapterAbi, functionName: "depositXDAI", args: [owner.address] }),
        scenario.walletCollateral,
      );
    }
    const credits = scenario.credits ?? {};
    if (credits.wallet || credits.tradeWallet) {
      await grantCredits(owner.address, (credits.wallet ?? 0n) + (credits.tradeWallet ?? 0n));
    }
    if (credits.tradeWallet) {
      await sendFrom(
        owner,
        route.token,
        encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [executor, credits.tradeWallet] }),
      );
    }

    const ctx: PredictCtx = {
      chainId: CHAIN_ID,
      owner: owner.address,
      executor,
      factory,
      router,
      collateral: session.collateralToken,
      parentMarket: session.parentMarket,
      sDaiAdapter: deposit.sDaiAdapter,
      credits: route,
    };
    const options = scenario.options(await roomyChildren());
    const children = session.children.map((child) => asOption(child));

    // what the popup reads, and the funding it shows
    const native = scenario.pay === "native";
    const rate = await client.readContract({
      address: deposit.sDai,
      abi: VAULT_ABI,
      functionName: "convertToAssets",
      args: [WAD],
    });
    const held = await app.fetchCredits(client, {
      contracts: { credits: route.token, manager: route.manager },
      owner: owner.address,
      tradeWallet: executor,
      collateral: session.collateralToken,
    });
    const offer = app.creditsOffer(held);
    const lines = scenario.useCredits === false ? [] : app.creditLines(held, offer);
    const funding = planFunding({
      amount: scenario.amount,
      ownWallet: native
        ? await client.getBalance({ address: owner.address })
        : await balance(session.collateralToken, owner.address),
      tradeWallet: await balance(session.collateralToken, executor),
      ...(native ? { tokenPerCollateralWad: rate } : {}),
      credits: lines,
    });
    expect(scenario.amount, "the scenario stays within what the popup offers").toBeLessThanOrEqual(funding.available);
    const request: PredictRequest = {
      options,
      ...fundingRequest(funding, native),
      startedAt: Math.floor(Date.now() / 1000),
    };

    const start = new Map<Address, { up: bigint; down: bigint; fees: { up: bigint; down: bigint } }>();
    for (const option of options) {
      start.set(option.childMarket, {
        up: await poolPrice(option.childMarket, "up"),
        down: await poolPrice(option.childMarket, "down"),
        fees: { up: await poolFee(option.childMarket, "up"), down: await poolFee(option.childMarket, "down") },
      });
    }

    const scope: LedgerScope = {
      owner: owner.address,
      executor,
      manager: route.manager,
      passThrough: [router, route.swaprRouter, deposit.sDaiAdapter],
      collateral: session.collateralToken,
      wxdai: route.wxdai,
      credits: route.token,
      options: children,
    };
    const before = await readLedger(client, scope);

    const sent: ScenarioRun["sent"] = [];
    let beforeBatch = scenario.beforeBatch;
    const driver = app.createPredictRun({
      gateway: createViemTxGateway({
        client,
        sendTransaction: async (tx) => {
          if (beforeBatch && tx.to.toLowerCase() === executor.toLowerCase()) {
            const hook = beforeBatch;
            beforeBatch = undefined;
            await hook();
          }
          const data = tx.data ?? "0x";
          const value = tx.value ?? 0n;
          const gas =
            scenario.gas ?? ((await client.estimateGas({ account: owner, to: tx.to, data, value })) * 3n) / 2n;
          const nonce = await client.getTransactionCount({ address: owner.address, blockTag: "pending" });
          try {
            const hash = await wallet.sendTransaction({ account: owner, chain: gnosis, to: tx.to, data, value, gas });
            sent.push({ stepId: "", tx, receipt: await client.waitForTransactionReceipt({ hash }) });
            return hash;
          } catch (error) {
            // hardhat mines a reverting send and answers it with an error, so its fee is found by nonce
            const block = await client.getBlock({ blockTag: "latest", includeTransactions: true });
            const mined = block.transactions.find(
              (each) => each.from.toLowerCase() === owner.address.toLowerCase() && each.nonce === nonce,
            );
            if (mined) sent.push({ stepId: "", tx, receipt: await client.getTransactionReceipt({ hash: mined.hash }) });
            throw error;
          }
        },
      }),
      reader: app.createPredictReader({
        client,
        sessionId: session.id,
        collateral: session.collateralToken,
        credits: { token: route.token, manager: route.manager },
      }),
      quoter: app.createLensQuoter(client, CHAIN_ID),
      creditsQuoter: app.createLensExactInputQuoter(client, CHAIN_ID),
      slippageBps: tolerances.SLIPPAGE_BPS,
      flowId: `predict-money-${owner.address}-${Date.now()}`,
      ctx: () => ctx,
      snapshot: () => request,
    });

    driver.start();
    await vi.waitFor(() => expect(["halted", "complete"]).toContain(driver.getProgress().stage), {
      timeout: 300_000,
      interval: 250,
    });
    const after = await readLedger(client, scope);
    return {
      ctx,
      funding,
      request,
      options,
      children,
      before,
      after,
      sent,
      progress: driver.getProgress(),
      driver,
      start,
    };
  }

  /** The batch transactions a run sent that landed. */
  const landedBatches = (run: Pick<ScenarioRun, "sent" | "ctx">) =>
    run.sent.filter(
      ({ tx, receipt }) => tx.to.toLowerCase() === run.ctx.executor.toLowerCase() && receipt.status === "success",
    );

  function batchCalls(data: Hex): Array<{ to: Address; data: Hex; value: bigint }> {
    const decoded = decodeFunctionData({ abi: app.tradeExecutorAbi, data });
    if (decoded.functionName === "batchValueExecute") return decoded.args[0].map((call) => ({ ...call }));
    if (decoded.functionName === "batchExecute") return decoded.args[0].map((call) => ({ ...call, value: 0n }));
    throw new Error(`Expected a batch, got ${decoded.functionName}`);
  }

  /**
   * M1 to M5 for one run that completed: every debit is what the popup showed, nothing is left
   * anywhere but the trade wallet, every option landed and received at least its minimums.
   */
  async function expectMoneyKept(run: ScenarioRun, opts: { landing?: boolean } = {}) {
    const { ctx, funding, request, before, after, sent } = run;
    const { owner, executor } = ctx;
    const collateral = session.collateralToken;
    const receipts = sent.map((each) => each.receipt);
    expect(run.progress.stage, JSON.stringify(run.progress.failure)).toBe("complete");

    // M2: the owner is debited exactly what the popup showed, gas aside
    expect(moved(before, after, owner, route.token), "credits moved from the wallet").toBe(-request.creditsFromEoa);
    if (request.depositNative) {
      expect(moved(before, after, owner, collateral)).toBe(0n);
      expect(moved(before, after, owner, "native")).toBe(-request.deposit - gasPaid(receipts));
    } else {
      expect(moved(before, after, owner, collateral), "sDAI from the wallet").toBe(-request.deposit);
      expect(moved(before, after, owner, "native")).toBe(-gasPaid(receipts));
    }
    expect(request.deposit, "the deposit is the one the popup showed").toBe(funding.deposit);
    expect(request.creditsToSpend, "the credits spent are the ones the popup showed").toBe(funding.creditsIn);

    // credits burned are the credits shown, paid by the manager one sDAI each
    expect(before.creditsSupply - after.creditsSupply, "credits burned").toBe(request.creditsToSpend);
    expect(moved(before, after, route.manager, collateral), "the manager's sDAI").toBe(-request.creditsToSpend);
    expect(moved(before, after, executor, route.token), "the trade wallet's credits").toBe(
      request.creditsFromEoa - request.creditsToSpend,
    );
    expect(moved(before, after, executor, "native"), "xDAI left in the trade wallet").toBe(0n);

    // M1: what only routes money keeps none of it
    for (const holder of [app.gnosisRouterAddress(CHAIN_ID)!, route.swaprRouter, ctx.sDaiAdapter!]) {
      for (const token of tokensOf({ ...SCOPE_TOKENS(run), credits: route.token })) {
        expect(moved(before, after, holder, token), `${holder} kept ${token}`).toBe(0n);
      }
      expect(moved(before, after, holder, "native"), `${holder} kept xDAI`).toBe(0n);
    }
    expect(await outsideRecipients(client, receipts, { owner, executor }), "paid to an outside account").toEqual([]);
    // the manager pays from its own sDAI, so the trade wallet never approves its sDAI to Swapr
    expect(
      await client.readContract({
        address: collateral,
        abi: erc20Abi,
        functionName: "allowance",
        args: [executor, route.swaprRouter],
      }),
    ).toBe(0n);

    // P2, A4: the parent split is the sDAI shown, and the credits add what their xDAI mints
    const batches = landedBatches(run);
    expect(batches.length, "every batch landed").toBeGreaterThan(0);
    const first = batchCalls(batches[0]!.tx.data!);
    const parent = first
      .filter((call) => call.to.toLowerCase() === ctx.router.toLowerCase())
      .map((call) => decodeFunctionData({ abi: app.gnosisRouterAbi, data: call.data }));
    const sDaiSplit = parent
      .filter(
        (call) =>
          call.functionName === "splitPosition" && call.args[1].toLowerCase() === ctx.parentMarket.toLowerCase(),
      )
      .reduce((sum, call) => sum + (call.args[2] as bigint), 0n);

    let landed = 0n;
    for (const { tx, receipt } of sent) {
      const to = tx.to.toLowerCase();
      if (receipt.status !== "success") continue;
      if (to !== collateral.toLowerCase() && to !== ctx.sDaiAdapter!.toLowerCase()) continue;
      if (
        to === collateral.toLowerCase() &&
        tx.data &&
        !tx.data.toLowerCase().includes(executor.slice(2).toLowerCase())
      )
        continue;
      landed +=
        (await balance(collateral, executor, receipt.blockNumber)) -
        (await balance(collateral, executor, receipt.blockNumber - 1n));
    }
    const shownSDai = funding.collateralIn - funding.creditsIn;
    if (request.depositNative) {
      const off = sDaiSplit > shownSDai ? sDaiSplit - shownSDai : shownSDai - sDaiSplit;
      expect(off, `the sDAI split ${sDaiSplit} against the ${shownSDai} shown`).toBeLessThanOrEqual(DUST_WEI);
    } else {
      expect(sDaiSplit, "the sDAI split is the sDAI shown").toBe(shownSDai);
    }
    expect(moved(before, after, executor, collateral), "the trade wallet's sDAI").toBe(landed - sDaiSplit);

    let minted = 0n;
    const execute = first.find((call) => call.to.toLowerCase() === route.manager.toLowerCase());
    if (request.creditsToSpend > 0n) {
      expect(execute, "the first batch spends the credits").toBeDefined();
      const [target, swap, amount, outputToken] = decodeFunctionData({
        abi: MANAGER_EXECUTE_ABI,
        data: execute!.data,
      }).args;
      expect([target.toLowerCase(), amount, outputToken.toLowerCase()]).toEqual([
        route.swaprRouter.toLowerCase(),
        request.creditsToSpend,
        route.wxdai.toLowerCase(),
      ]);
      const [leg] = decodeFunctionData({ abi: SWAPR_ROUTER_ABI, data: swap }).args;
      expect(leg.recipient.toLowerCase()).toBe(executor.toLowerCase());
      const unwrap = first.find((call) => call.to.toLowerCase() === route.wxdai.toLowerCase())!;
      const [floor] = decodeFunctionData({ abi: WXDAI_WITHDRAW_ABI, data: unwrap.data }).args;
      expect(floor).toBe(leg.amountOutMinimum);
      const base = first.find((call) => call.value > 0n)!;
      expect(base.value).toBe(floor);

      // what splitFromBase minted is the vault's preview of the floor
      const block = batches[0]!.receipt.blockNumber;
      const supply = (blockNumber: bigint) =>
        client.readContract({ address: collateral, abi: VAULT_ABI, functionName: "totalSupply", blockNumber });
      minted = (await supply(block)) - (await supply(block - 1n));
      const preview = await client.readContract({
        address: collateral,
        abi: VAULT_ABI,
        functionName: "previewDeposit",
        args: [floor],
        blockNumber: block - 1n,
      });
      const off = minted > preview ? minted - preview : preview - minted;
      expect(off, `minted ${minted} against the vault's preview ${preview}`).toBeLessThanOrEqual(DUST_WEI);

      // the credits leg loses no more to the pool than the caps allow, against the vault rate
      const value = (shares: bigint) =>
        client.readContract({
          address: collateral,
          abi: VAULT_ABI,
          functionName: "convertToAssets",
          args: [shares],
          blockNumber: block - 1n,
        });
      const kept = 10_000n - BigInt(tolerances.CREDITS_MAX_LOSS_BPS) - BigInt(tolerances.CREDITS_SLIPPAGE_BPS);
      expect(await value(minted)).toBeGreaterThanOrEqual(((await value(request.creditsToSpend)) * kept) / 10_000n);

      // the swap's surplus over the floor stays in the trade wallet as WXDAI, within the slippage allowance
      const dust = moved(before, after, executor, route.wxdai);
      expect(dust).toBeGreaterThanOrEqual(0n);
      const slip = BigInt(tolerances.CREDITS_SLIPPAGE_BPS);
      expect(dust).toBeLessThanOrEqual((floor * slip) / (10_000n - slip) + 1n);
    } else {
      expect(execute, "no credits spent").toBeUndefined();
      expect(moved(before, after, executor, route.wxdai)).toBe(0n);
    }
    const perChild = sDaiSplit + minted;

    // M3: every option split what both sources minted, received at least its minimums, and landed
    const calls = batches.flatMap((batch) => batchCalls(batch.tx.data!));
    const signed = signedOptions(calls, run.options, { gnosisRouter: ctx.router, swaprRouter: route.swaprRouter });
    const skipped = run.progress.skipped.map((market) => market.toLowerCase());
    for (const child of run.children) {
      const option = run.options.find((each) => each.childMarket === child.childMarket);
      const legs = signed.get(child.childMarket);
      const held = before.tokens.get(executor)!.get(child.underlying)!;
      if (!option || !legs || legs.legInputs.length === 0) {
        if (option)
          expect(skipped, `${option.childMarket} was left out without saying so`).toContain(
            option.childMarket.toLowerCase(),
          );
        // an option the run did not trade keeps what the parent split gave it
        expect(moved(before, after, executor, child.underlying), `${child.childMarket}'s underlying`).toBe(perChild);
        continue;
      }
      expect(legs.childSplit, `${child.childMarket} splits all it holds`).toBe(held + perChild);
      for (const token of [option.upToken, option.downToken]) {
        const floor =
          legs.childSplit -
          (legs.sold.get(token.toLowerCase() as Address) ?? 0n) -
          legs.merge +
          (legs.boughtAtLeast.get(token.toLowerCase() as Address) ?? 0n);
        expect(
          moved(before, after, executor, token),
          `${token} received at least the plan's minimum; legs ${JSON.stringify(legs, (_, v) => (typeof v === "bigint" ? v.toString() : v instanceof Map ? Object.fromEntries(v) : v))} option ${option.childMarket} up ${option.upToken} down ${option.downToken}`,
        ).toBeGreaterThanOrEqual(floor);
      }
      expect(moved(before, after, executor, option.invalidToken)).toBe(legs.childSplit - legs.merge);

      const [up, down] = [await poolPrice(option.childMarket, "up"), await poolPrice(option.childMarket, "down")];
      if (opts.landing !== false) {
        expectAtTarget(up, option.targetPriceWad, `${option.childMarket} UP`);
        expectAtTarget(down, WAD - option.targetPriceWad, `${option.childMarket} DOWN`);
      }

      // M1: valued at where the pools end, the option gained what was split into it, less fees
      const startAt = run.start.get(option.childMarket)!;
      const fees = { up: startAt.fees.up, down: startAt.fees.down };
      for (const side of ["up", "down"] as const) {
        const now = await poolFee(option.childMarket, side);
        if (now > fees[side]) fees[side] = now;
      }
      const worth = (ledger: Ledger) => {
        const row = ledger.tokens.get(executor)!;
        return (
          row.get(option.underlying)! +
          (row.get(option.upToken)! * up) / WAD +
          (row.get(option.downToken)! * down) / WAD
        );
      };
      const feesPaid = legs.legInputs.reduce((sum, leg) => sum + (leg.amountIn * fees[leg.pool]) / FEE_DENOMINATOR, 0n);
      const slack = (perChild * 2n) / 10_000n + 10n;
      expect(worth(after) - worth(before), `${option.childMarket} lost value beyond its fees`).toBeGreaterThanOrEqual(
        perChild - feesPaid - slack,
      );
    }
  }

  /** The tokens the ledger reads, for the pass-through check. */
  const SCOPE_TOKENS = (run: ScenarioRun): LedgerScope => ({
    owner: run.ctx.owner,
    executor: run.ctx.executor,
    manager: route.manager,
    passThrough: [],
    collateral: session.collateralToken,
    wxdai: route.wxdai,
    credits: route.token,
    options: run.children,
  });

  const nudged = (count: number) => (children: Array<{ child: Child; up: bigint }>) =>
    children.slice(0, count).map(({ child, up }) => asOption(child, up + NUDGE));

  it.skipIf(!FORK_RPC_URL)(
    "sDAI only: debits the sDAI shown and lands the estimate",
    async () => {
      const run = await runScenario({
        key: nextKey(),
        pay: "collateral",
        amount: parseEther("40"),
        walletCollateral: parseEther("100"),
        options: nudged(1),
      });
      expect(run.request.creditsToSpend).toBe(0n);
      await expectMoneyKept(run);
    },
    600_000,
  );

  it.skipIf(!FORK_RPC_URL)(
    "xDAI only: debits the xDAI shown and splits what it minted",
    async () => {
      const run = await runScenario({ key: nextKey(), pay: "native", amount: parseEther("50"), options: nudged(1) });
      await expectMoneyKept(run);
    },
    600_000,
  );

  it.skipIf(!FORK_RPC_URL)(
    "credits only: moves and burns exactly the credits shown, and nothing else of the visitor's",
    async () => {
      const run = await runScenario({
        key: nextKey(),
        pay: "collateral",
        amount: parseEther("30"),
        credits: { wallet: parseEther("40") },
        options: nudged(1),
      });
      expect(run.request).toMatchObject({
        creditsFromEoa: parseEther("30"),
        creditsToSpend: parseEther("30"),
        deposit: 0n,
      });
      await expectMoneyKept(run);
    },
    600_000,
  );

  it.skipIf(!FORK_RPC_URL)(
    "credits and sDAI: spends the credits first and the sDAI for the rest (A9)",
    async () => {
      const run = await runScenario({
        key: nextKey(),
        pay: "collateral",
        amount: parseEther("40"),
        walletCollateral: parseEther("100"),
        credits: { wallet: parseEther("15") },
        options: nudged(1),
      });
      expect(run.request).toMatchObject({ creditsToSpend: parseEther("15"), collateralIn: parseEther("25") });
      await expectMoneyKept(run);
    },
    600_000,
  );

  it.skipIf(!FORK_RPC_URL)(
    "credits and xDAI: spends the credits and deposits xDAI for the rest",
    async () => {
      const run = await runScenario({
        key: nextKey(),
        pay: "native",
        amount: parseEther("50"),
        credits: { wallet: parseEther("12") },
        options: nudged(1),
      });
      expect(run.request.creditsToSpend).toBe(parseEther("12"));
      expect(run.request.depositNative).toBe(true);
      await expectMoneyKept(run);
    },
    600_000,
  );

  it.skipIf(!FORK_RPC_URL)(
    "credits already in the trade wallet are spent first, with no transfer signed",
    async () => {
      const run = await runScenario({
        key: nextKey(),
        pay: "collateral",
        amount: parseEther("30"),
        walletCollateral: parseEther("100"),
        credits: { tradeWallet: parseEther("10"), wallet: parseEther("5") },
        options: nudged(1),
      });
      expect(run.request).toMatchObject({ creditsToSpend: parseEther("15"), creditsFromEoa: parseEther("5") });
      expect(run.funding.credits).toEqual([
        { kind: "foresight", fromTradeWallet: parseEther("10"), fromWallet: parseEther("5") },
      ]);
      await expectMoneyKept(run);

      const held = await runScenario({
        key: FRESH_KEYS[(fresh - 1) % FRESH_KEYS.length]!,
        pay: "collateral",
        amount: parseEther("10"),
        credits: { tradeWallet: parseEther("10") },
        options: nudged(1),
      });
      expect(held.request.creditsFromEoa).toBe(0n);
      expect(held.sent.some(({ tx }) => tx.to.toLowerCase() === route.token.toLowerCase())).toBe(false);
      await expectMoneyKept(held, { landing: false });
    },
    900_000,
  );

  it.skipIf(!FORK_RPC_URL)(
    "an empty manager offers no credits and moves none; a short one is used for what it holds",
    async () => {
      await drainManager();
      const empty = await runScenario({
        key: nextKey(),
        pay: "collateral",
        amount: parseEther("20"),
        walletCollateral: parseEther("50"),
        credits: { wallet: parseEther("10") },
        options: nudged(1),
      });
      expect(
        app.creditsOffer(
          await app.fetchCredits(client, {
            contracts: { credits: route.token, manager: route.manager },
            owner: empty.ctx.owner,
            tradeWallet: empty.ctx.executor,
            collateral: session.collateralToken,
          }),
        ).state,
      ).toBe("empty");
      expect(empty.request).toMatchObject({ creditsToSpend: 0n, creditsFromEoa: 0n });
      await expectMoneyKept(empty, { landing: false });

      await refillManager(parseEther("3"));
      const short = await runScenario({
        key: nextKey(),
        pay: "collateral",
        amount: parseEther("20"),
        walletCollateral: parseEther("50"),
        credits: { wallet: parseEther("10") },
        options: nudged(1),
      });
      expect(short.request).toMatchObject({ creditsToSpend: parseEther("3"), collateralIn: parseEther("17") });
      await expectMoneyKept(short, { landing: false });
    },
    900_000,
  );

  it.skipIf(!FORK_RPC_URL)(
    "a first batch that reverts leaves the credits in the trade wallet, and the retry spends them once (A8)",
    async () => {
      const key = nextKey();
      const run = await runScenario({
        key,
        pay: "collateral",
        amount: parseEther("30"),
        walletCollateral: parseEther("100"),
        credits: { wallet: parseEther("10") },
        options: nudged(1),
        beforeBatch: drainManager,
        gas: 8_000_000n,
      });
      expect(run.progress.failure?.reason).toBe("reverted");
      const owner = privateKeyToAccount(key);
      const executor = run.ctx.executor;
      expect(await balance(route.token, executor), "the credits wait in the trade wallet").toBe(parseEther("10"));
      expect(await balance(route.token, owner.address)).toBe(0n);

      // the trade wallet shows them and they can be withdrawn
      const shown = await app.fetchCredits(client, {
        contracts: { credits: route.token, manager: route.manager },
        owner: owner.address,
        tradeWallet: executor,
        collateral: session.collateralToken,
      });
      expect(shown?.tradeWallet).toBe(parseEther("10"));
      const withdraw = app.withdrawTx({
        executor,
        recipient: owner.address,
        assets: [{ token: route.token, amount: parseEther("10") }],
      });
      await client.call({ account: owner, to: withdraw.to, data: withdraw.data });

      // the manager is refilled and the run resumes from the batch, spending the credits once
      await refillManager(parseEther("100"));
      run.driver.retry();
      await vi.waitFor(() => expect(["halted", "complete"]).toContain(run.driver.getProgress().stage), {
        timeout: 300_000,
        interval: 250,
      });
      const after = await readLedger(client, SCOPE_TOKENS(run));
      const transfers = run.sent.filter(({ tx }) => tx.to.toLowerCase() === route.token.toLowerCase());
      expect(transfers).toHaveLength(1);
      // the manager lost what the governor swept and got back the refill, then paid the credits
      await expectMoneyKept(
        {
          ...run,
          after,
          progress: run.driver.getProgress(),
          before: {
            ...run.before,
            tokens: new Map(
              [...run.before.tokens].map(([holder, row]) => [
                holder,
                holder === route.manager
                  ? new Map(
                      [...row].map(([token, value]) => [
                        token,
                        token === session.collateralToken ? parseEther("100") : value,
                      ]),
                    )
                  : row,
              ]),
            ),
          },
        },
        { landing: false },
      );
    },
    900_000,
  );

  it.skipIf(!FORK_RPC_URL)(
    "many options at once, some already at their estimate, lands each one moved and names each left out",
    async () => {
      const run = await runScenario({
        key: nextKey(),
        pay: "collateral",
        amount: parseEther("120"),
        walletCollateral: parseEther("200"),
        credits: { wallet: parseEther("20") },
        options: (children) =>
          children.slice(0, 5).map(({ child, up }, index) => asOption(child, index % 2 === 0 ? up + NUDGE : up)),
      });
      const stays = run.options.filter((_, index) => index % 2 === 1).map((each) => each.childMarket.toLowerCase());
      // an estimate at the UP price can still leave the DOWN pool to move, so only those may be left out
      for (const market of run.progress.skipped) expect(stays).toContain(market.toLowerCase());
      await expectMoneyKept(run);
    },
    900_000,
  );

  it.skipIf(!FORK_RPC_URL)(
    "a returning predictor's second run trades from the positions the first left, and keeps the money",
    async () => {
      const key = nextKey();
      const first = await runScenario({
        key,
        pay: "collateral",
        amount: parseEther("30"),
        walletCollateral: parseEther("100"),
        credits: { wallet: parseEther("5") },
        options: nudged(1),
      });
      await expectMoneyKept(first);

      const second = await runScenario({
        key,
        pay: "collateral",
        amount: parseEther("20"),
        credits: { wallet: parseEther("5") },
        options: (children) => {
          const target = first.options[0]!;
          const now = children.find(({ child }) => child.id === target.childMarket);
          if (!now) throw new Error("The first run's option left the roomy band.");
          return [asOption(now.child, now.up - NUDGE * 2n)];
        },
      });
      const held = second.before.tokens.get(second.ctx.executor)!;
      expect(held.get(first.options[0]!.upToken)! + held.get(first.options[0]!.downToken)!).toBeGreaterThan(0n);
      await expectMoneyKept(second);
    },
    900_000,
  );
});
