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
  type Hex,
  type Log,
  type PrivateKeyAccount,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { gnosis } from "viem/chains";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PredictCtx, PredictOption, PredictSnapshot } from "../types";

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
});

/**
 * The predict flow against a real chain: `yarn local-stack gnosis-fork`, then
 * `yarn simulate:session:gnosis-fork --liquidity`, then this with FORK_RPC_URL set.
 *
 * Nothing else exercises the calldata. Every unit test above proves the plan is the plan we
 * meant; only this proves Seer's router and Swapr's pools accept it.
 */
const FORK_RPC_URL = process.env.FORK_RPC_URL;
const HASURA_URL = process.env.FORK_HASURA_URL ?? "http://localhost:8080/v1/graphql";
const HASURA_SECRET = process.env.FORK_HASURA_SECRET ?? "testing";
/** Hardhat's first account, which a fork funds. */
const OWNER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

/** Seer's LensQuoter on Gnosis, which quotes every swap. */
const LENS_QUOTER = "0x82150d38288e53AfcF20a5eEee47682c5Ef796d8" as const;
const LIVE_GNOSIS_RPC = process.env.FORK_UPSTREAM_RPC_URL ?? "https://rpc.gnosischain.com";

/**
 * ADR 0023 pins the fork to the block Foresight's own contracts were deployed at, which is
 * older than Seer's LensQuoter. Copying its live runtime code onto the fork is cheaper than
 * re-pinning, which would make the indexer replay half a million blocks.
 */
async function grantLensQuoter(rpcUrl: string): Promise<void> {
  const call = async (url: string, method: string, params: unknown[]) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    return ((await response.json()) as { result?: string }).result;
  };

  if ((await call(rpcUrl, "eth_getCode", [LENS_QUOTER, "latest"])) !== "0x") return;

  const code = await call(LIVE_GNOSIS_RPC, "eth_getCode", [LENS_QUOTER, "latest"]);
  if (!code || code === "0x") throw new Error("The LensQuoter is not deployed on gnosis either.");
  await call(rpcUrl, "hardhat_setCode", [LENS_QUOTER, code]);
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

async function newestSession(): Promise<ForkSession> {
  const response = await fetch(HASURA_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-hasura-admin-secret": HASURA_SECRET },
    body: JSON.stringify({
      query: `{ Session(order_by: {openedAt: desc}, limit: 1) { id parentMarket collateralToken
        children { id upToken downToken invalidToken underlyingToken lowerBound upperBound } } }`,
    }),
  });
  const body = (await response.json()) as { data: { Session: ForkSession[] } };
  const session = body.data.Session[0];
  if (!session) throw new Error("No session indexed. Run `yarn simulate:session:gnosis-fork --liquidity` first.");
  return session;
}

describe("the predict flow, against a gnosis fork", () => {
  const account = privateKeyToAccount(OWNER_KEY);
  let client: PublicClient;
  let wallet: WalletClient;
  let session: ForkSession;

  beforeAll(async () => {
    if (!FORK_RPC_URL) return;
    const transport = http(FORK_RPC_URL);
    client = createPublicClient({ chain: gnosis, transport }) as PublicClient;
    wallet = createWalletClient({ account, chain: gnosis, transport });
    await grantLensQuoter(FORK_RPC_URL!);
    session = await newestSession();
  }, 120_000);

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

      // one option, asked to move well above where the pool sits
      const child = session.children[0]!;
      const option: PredictOption = {
        childMarket: child.id,
        underlying: child.underlyingToken,
        upToken: child.upToken,
        downToken: child.downToken,
        invalidToken: child.invalidToken,
        targetPriceWad: (10n ** 18n * 85n) / 100n,
      };

      const before = await readPoolLiquidity(client, optionPoolRefs(await fetchSessionPools(session.id), child.id).up!);
      const priceBefore = priceFromSqrtPriceX96(before.sqrtPriceX96, before.outcomeIsToken0);

      const ctx: PredictCtx = {
        chainId: CHAIN_ID,
        owner: account.address,
        executor: predicted,
        factory,
        router,
        collateral,
        parentMarket: session.parentMarket,
        sDaiAdapter: route.sDaiAdapter,
      };
      const snapshot: PredictSnapshot = {
        options: [option],
        deposit: DEPOSIT,
        depositNative: false,
        collateralIn: DEPOSIT,
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
      }

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
    const transport = http(FORK_RPC_URL);
    client = createPublicClient({ chain: gnosis, transport }) as PublicClient;
    wallet = createWalletClient({ chain: gnosis, transport });
    await grantLensQuoter(FORK_RPC_URL);
    session = await newestSession();
    app = await load();
    tolerances = await import("../../oracle/tolerances");
  }, 120_000);

  beforeEach(async () => {
    if (!FORK_RPC_URL) return;
    snapshotId = await rpc<string>("evm_snapshot");
  });

  afterEach(async () => {
    if (!FORK_RPC_URL) return;
    await rpc("evm_revert", [snapshotId]);
  });

  type Side = "up" | "down";

  const send = async (from: PrivateKeyAccount, to: Address, data: Hex = "0x", value = 0n) => {
    const hash = await wallet.sendTransaction({ account: from, chain: gnosis, to, data, value });
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

  const poolRef = async (child: ForkSession["children"][number], side: Side) => {
    const ref = app.optionPoolRefs(await app.fetchSessionPools(session.id), child.id)[side];
    if (!ref) throw new Error(`${child.id} has no ${side} pool.`);
    return ref;
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
    };
    const snapshot: PredictSnapshot = {
      options: [option],
      deposit,
      depositNative: false,
      collateralIn: deposit,
      startedAt: Math.floor(Date.now() / 1000),
    };
    const deps = {
      reader: app.createPredictReader({ client, sessionId: session.id, collateral: session.collateralToken }),
      quoter: app.createLensQuoter(client, CHAIN_ID),
      slippageBps: tolerances.SLIPPAGE_BPS,
    };

    const sent: Array<{ id: string; status: string; data: Hex; logs: Log[] }> = [];
    for (const step of app.planPredict(snapshot, deps)) {
      if (await step.canSkip?.(ctx, snapshot)) continue;
      const tx = await step.build(ctx, snapshot);
      if (step.id.startsWith("predict-")) await beforeSend?.();

      let status = "success";
      let logs: Log[] = [];
      try {
        logs = (await send(owner, tx.to, tx.data, tx.value ?? 0n)).logs;
      } catch (reason) {
        status = `reverted: ${String(reason).split("\n")[0]}`;
      }
      sent.push({ id: step.id, status, data: tx.data ?? "0x", logs });
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

        await rpc("evm_revert", [snapshotId]);
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

        await rpc("evm_revert", [snapshotId]);
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
