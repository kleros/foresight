import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  http,
  parseEther,
  type Address,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { gnosis } from "viem/chains";
import { beforeAll, describe, expect, it } from "vitest";

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
      const steps = planPredict(snapshot, {
        reader,
        quoter: createLensQuoter(client, CHAIN_ID),
        slippageBps: 300,
        onSkip: (each, reason) => skipped.push(`${each.childMarket}: ${String(reason)}`),
      });

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
