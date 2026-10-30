import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  http,
  parseEther,
  parseEventLogs,
  type Address,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { gnosis } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CREDITS_SLIPPAGE_BPS } from "../../oracle/tolerances";
import type { PredictCtx, PredictOption, PredictSnapshot } from "../types";

/**
 * Acceptance test A6 of issue 2026-10-30-foresight-market-trade-history: after a prediction across
 * two options on the fork, the app's trade history has one row for it naming both options, sized at
 * the underlying the trade wallet put into them in that transaction.
 *
 * Needs `yarn local-stack gnosis-fork` with the indexer built from the trade-history branch, and
 * `yarn simulate:session:gnosis-fork --liquidity`; skips with no FORK_RPC_URL.
 *
 * The history is read through `fetchSessionTrades(sessionId)` from
 * `@/features/sessions/api/getSessionTrades`, which resolves to `{ trades }`, newest first, where a
 * prediction is `{ kind: "prediction", transactionHash, options: { childMarket }[], cost }` and `cost`
 * is the underlying summed over its options, as a bigint.
 *
 * It sends from its own account and rewinds the fork once the indexer has served the trade.
 */
const FORK_RPC_URL = process.env.FORK_RPC_URL;
const FORK_RPC_TIMEOUT_MS = 60_000;
const HASURA_URL = process.env.FORK_HASURA_URL ?? "http://localhost:8080/v1/graphql";
const HASURA_SECRET = process.env.FORK_HASURA_SECRET ?? "testing";
/** Hardhat's fifth account, which no other fork suite sends from. */
const TRADER_KEY = "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a" as const;
const DEPOSIT = parseEther("50");
const CHAIN_ID = 100;
const INDEXED_WITHIN_MS = 120_000;

/** The app's modules read validated env when they load, so they are pulled in inside the test. */
const load = async () => ({
  ...(await import("@/lib/swap/lens")),
  ...(await import("@/lib/swap/algebraPool")),
  ...(await import("@/lib/trade-executor/executor")),
  ...(await import("@/config/contracts")),
  ...(await import("../../api/getOptionPools")),
  ...(await import("../../utils/poolMath")),
  ...(await import("../../run/reader")),
  ...(await import("../plan")),
  ...(await import("@/features/sessions/api/getSessionTrades")),
});

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
  }>;
}

async function hasura<T>(query: string): Promise<T> {
  const response = await fetch(HASURA_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-hasura-admin-secret": HASURA_SECRET },
    body: JSON.stringify({ query }),
  });
  const body = (await response.json()) as { data: T; errors?: unknown };
  if (body.errors) throw new Error(`Hasura: ${JSON.stringify(body.errors)}`);
  return body.data;
}

async function newestSessionWithTwoPricedOptions(): Promise<ForkSession> {
  const { Session } = await hasura<{ Session: ForkSession[] }>(
    `{ Session(where: {children: {pools: {id: {_is_null: false}}}}, order_by: {openedAt: desc}, limit: 1) { id parentMarket collateralToken
      children { id upToken downToken invalidToken underlyingToken } } }`,
  );
  const session = Session[0];
  if (!session || session.children.length < 2)
    throw new Error(
      "No session with two options and pools. Run `yarn simulate:session:gnosis-fork --liquidity` first.",
    );
  return session;
}

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

const transfersOf = (receipt: TransactionReceipt, token: Address) =>
  parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs }).filter(
    (log) => log.address.toLowerCase() === token.toLowerCase(),
  );

/** The trade wallet's net movement of `token` in one receipt, read off its Transfer logs. */
function netMoved(receipt: TransactionReceipt, token: Address, wallet: Address): bigint {
  return transfersOf(receipt, token).reduce((sum, log) => {
    const into = log.args.to.toLowerCase() === wallet.toLowerCase() ? log.args.value : 0n;
    const out = log.args.from.toLowerCase() === wallet.toLowerCase() ? log.args.value : 0n;
    return sum + into - out;
  }, 0n);
}

/** What one receipt moved of `token` from `from` to `to`. */
const sent = (receipt: TransactionReceipt, token: Address, from: Address, to: Address) =>
  transfersOf(receipt, token)
    .filter(
      (log) => log.args.from.toLowerCase() === from.toLowerCase() && log.args.to.toLowerCase() === to.toLowerCase(),
    )
    .reduce((sum, log) => sum + log.args.value, 0n);

const touchesOutcomes = (receipt: TransactionReceipt, child: ForkSession["children"][number], wallet: Address) =>
  netMoved(receipt, child.upToken, wallet) !== 0n || netMoved(receipt, child.downToken, wallet) !== 0n;

describe("the All trades history after a prediction, against a gnosis fork", () => {
  const account = privateKeyToAccount(TRADER_KEY);
  let client: PublicClient;
  let wallet: WalletClient;
  let session: ForkSession;
  let snapshotId: string | undefined;

  beforeAll(async () => {
    if (!FORK_RPC_URL) return;
    const transport = http(FORK_RPC_URL, { timeout: FORK_RPC_TIMEOUT_MS });
    client = createPublicClient({ chain: gnosis, transport }) as PublicClient;
    wallet = createWalletClient({ account, chain: gnosis, transport });
    session = await newestSessionWithTwoPricedOptions();
    snapshotId = await rpc<string>("evm_snapshot");
  }, 120_000);

  // The indexer reads a rewound height as a reorg; mining past the height reached lets it settle
  // on empty blocks before anything else is seeded on the fork.
  afterAll(async () => {
    if (!FORK_RPC_URL || !snapshotId) return;
    const reached = BigInt(await rpc<string>("eth_blockNumber"));
    await rpc("evm_revert", [snapshotId]);
    const head = BigInt(await rpc<string>("eth_blockNumber"));
    if (head <= reached) await rpc("hardhat_mine", [`0x${(reached - head + 1n).toString(16)}`]);
  }, 120_000);

  it.skipIf(!FORK_RPC_URL)(
    "lists a two-option prediction as one row naming both options, sized at the underlying it put into them",
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
        fetchSessionTrades,
      } = await load();

      const collateral = session.collateralToken;
      const router = gnosisRouterAddress(CHAIN_ID);
      const factory = tradeExecutorFactoryAddress(CHAIN_ID);
      const route = sDaiDepositRoute(collateral, CHAIN_ID);
      if (!router || !factory || !route) throw new Error("This chain is missing the Seer deployment.");

      const minted = await wallet.sendTransaction({
        account,
        chain: gnosis,
        to: route.sDaiAdapter,
        value: DEPOSIT * 2n,
        data: encodeFunctionData({ abi: sDaiAdapterAbi, functionName: "depositXDAI", args: [account.address] }),
      });
      await client.waitForTransactionReceipt({ hash: minted });

      const { predicted } = await fetchExecutorState(client, { factory, owner: account.address });
      const [first, second] = session.children as [ForkSession["children"][number], ForkSession["children"][number]];
      expect(first.underlyingToken.toLowerCase()).not.toBe(second.underlyingToken.toLowerCase());

      const pools = await fetchSessionPools(
        client,
        session.children.map((child) => ({
          childMarket: child.id,
          underlying: child.underlyingToken,
          upToken: child.upToken,
          downToken: child.downToken,
        })),
      );
      const upPrice = async (child: ForkSession["children"][number]) => {
        const liquidity = await readPoolLiquidity(client, optionPoolRefs(pools, child.id).up!);
        return priceFromSqrtPriceX96(liquidity.sqrtPriceX96, liquidity.outcomeIsToken0);
      };
      const optionOf = (child: ForkSession["children"][number], targetPriceWad: bigint): PredictOption => ({
        childMarket: child.id,
        underlying: child.underlyingToken,
        upToken: child.upToken,
        downToken: child.downToken,
        invalidToken: child.invalidToken,
        targetPriceWad,
      });
      // one estimate above its market and one below, so the run buys UP on one and DOWN on the other
      const firstPrice = await upPrice(first);
      const secondPrice = await upPrice(second);
      const options = [
        optionOf(first, firstPrice + (10n ** 18n - firstPrice) / 2n),
        optionOf(second, secondPrice / 2n),
      ];

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
      const reader = createPredictReader({ client, sessionId: session.id, collateral });
      const snapshot: PredictSnapshot = {
        options,
        deposit: DEPOSIT,
        depositNative: false,
        collateralIn: DEPOSIT,
        collateralBefore: 0n,
        creditsFromEoa: 0n,
        creditsToSpend: 0n,
        creditsAtStart: 0n,
        collateralAtStart: await reader.collateralBalance(ctx.executor),
        fromBlock: (await client.getBlockNumber()) + 1n,
        slippage: { tradeBps: 300, creditsBps: CREDITS_SLIPPAGE_BPS },
        // both options in one batch, so one transaction trades both
        optionsPerBatch: 2,
        startedAt: Math.floor(Date.now() / 1000),
      };
      const leftOut: string[] = [];
      const steps = planPredict(snapshot, {
        reader,
        quoter: createLensQuoter(client, CHAIN_ID),
        onLeftOut: (each: PredictOption, reason: unknown) => leftOut.push(`${each.childMarket}: ${String(reason)}`),
      });

      const receipts: TransactionReceipt[] = [];
      for (const step of steps) {
        if (await step.canSkip?.(ctx, snapshot)) continue;
        let tx;
        try {
          tx = await step.build(ctx, snapshot);
        } catch (reason) {
          throw new Error(`${step.id} could not be built: ${String(reason)}\n${leftOut.join("\n")}`);
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
      }

      const trade = receipts.find(
        (receipt) => touchesOutcomes(receipt, first, predicted) && touchesOutcomes(receipt, second, predicted),
      );
      expect(trade, `no transaction traded both options\n${leftOut.join("\n")}`).toBeDefined();
      const hash = trade!.transactionHash.toLowerCase();
      // The sDAI split at the parent credits each option's underlying one for one; what the option
      // took in is that credit less what its underlying netted in the same receipt.
      const credited = sent(trade!, collateral, predicted, router);
      expect(credited, "the trade's own receipt splits sDAI at the parent").toBeGreaterThan(0n);
      const expectedSize = [first, second].reduce(
        (sum, child) => sum + credited - netMoved(trade!, child.underlyingToken, predicted),
        0n,
      );

      const deadline = Date.now() + INDEXED_WITHIN_MS;
      for (;;) {
        const { Prediction } = await hasura<{ Prediction: unknown[] }>(
          `{ Prediction(where: {transactionHash: {_eq: "${hash}"}}) { id } }`,
        );
        if (Prediction.length >= 2) break;
        if (Date.now() > deadline) throw new Error(`The indexer never served both options of ${hash}.`);
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }

      const { trades } = await fetchSessionTrades(session.id);
      const rows = trades.filter((row) => row.kind === "prediction" && row.transactionHash.toLowerCase() === hash);

      expect(rows).toHaveLength(1);
      const row = rows[0] as Extract<(typeof trades)[number], { kind: "prediction" }>;
      expect(row.options.map((option) => option.childMarket.toLowerCase()).sort()).toEqual(
        [first.id.toLowerCase(), second.id.toLowerCase()].sort(),
      );
      expect(row.cost).toBe(expectedSize);
    },
    600_000,
  );
});
