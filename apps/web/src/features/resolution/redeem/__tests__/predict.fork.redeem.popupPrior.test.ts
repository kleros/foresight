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

/** Oracle R3 and A8 for a trade wallet already holding sDAI; run by `apps/web/scripts/test-fork-redeem.sh`.
 * `batchExecute` checks no balance, so only the guard's exact amount keeps that sDAI in place. */
const FORK_RPC_URL = process.env.FORK_RPC_URL;
const HARDHAT_FORK_URL = "http://127.0.0.1:8545";
const SETUP_TIMEOUT_MS = 900_000;
const RUN_TIMEOUT_MS = 600_000;
const CHAIN_ID = 100;
const REPO_ROOT = path.resolve(import.meta.dirname, "../../../../../../..");

const OWNER: Address = "0x1a00000000000000000000000000000000000c71";
const S_DAI: Address = "0xaf204776c7245bF4147c2612BF6e5972Ee483701";
const MARKET_ABI = parseAbi(["function wrappedOutcome(uint256 index) view returns (address wrapped1155, bytes data)"]);
const OPTIONS = 3;

const load = async () => ({
  ...(await import("../../api/getTradeWalletRedeemToOwner")),
  ...(await import("../payOwner")),
  ...(await import("@/config/contracts")),
  ...(await import("@/lib/trade-executor/executor")),
  ...(await import("@/lib/trade-executor/positions")),
});

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

describe.skipIf(!FORK_RPC_URL)(
  "the owner transfer from a trade wallet that already holds sDAI, on a gnosis fork",
  () => {
    let client: PublicClient;
    let wallet: WalletClient;
    let app: Awaited<ReturnType<typeof load>>;
    let snapshotId: string;
    let factory: Address;
    let sessionId: bigint;
    let tradeWallet: Address;

    const balanceOf = (token: Address, account: Address) =>
      client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account] });

    async function send(to: Address, data: Hex, value = 0n) {
      const gas = ((await client.estimateGas({ account: OWNER, to, data, value })) * 3n) / 2n;
      const hash = await wallet.sendTransaction({ account: OWNER, chain: gnosis, to, data, value, gas });
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`transaction to ${to} reverted`);
    }
    const sendTx = (tx: FlowTx) => send(tx.to, tx.data!);
    const transfer = (to: Address, amount: bigint) => ({
      to: S_DAI,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] }),
    });

    /** The ticked batch with its transfer set to `amount`. */
    function withAmount(tx: FlowTx, amount: bigint) {
      const outer = decodeFunctionData({ abi: app.tradeExecutorAbi, data: tx.data! });
      if (outer.functionName !== "batchExecute") throw new Error(outer.functionName);
      return app.batchExecuteTx(tradeWallet, [...outer.args[0].slice(0, -1), transfer(OWNER, amount)]);
    }

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
      const transport = http(FORK_RPC_URL, { timeout: 60_000 });
      client = createPublicClient({ chain: gnosis, transport, pollingInterval: 100 }) as PublicClient;
      wallet = createWalletClient({ chain: gnosis, transport, pollingInterval: 100 });
      app = await load();
      factory = app.sessionFactoryAddress(CHAIN_ID)!;
      const router = app.gnosisRouterAddress(CHAIN_ID)!;
      const executorFactory = app.tradeExecutorFactoryAddress(CHAIN_ID)!;
      const route = app.sDaiDepositRoute(S_DAI, CHAIN_ID)!;

      snapshotId = await rpc<string>("evm_snapshot");
      await rpc("hardhat_impersonateAccount", [OWNER]);
      await rpc("hardhat_setBalance", [OWNER, hex(parseEther("10000"))]);
      tradeWallet = app.executorAddress(executorFactory, OWNER);
      const createTx = app.createExecutorTx(executorFactory);
      await send(createTx.to, createTx.data!);
      await send(
        route.sDaiAdapter,
        encodeFunctionData({ abi: app.sDaiAdapterAbi, functionName: "depositXDAI", args: [tradeWallet] }),
        parseEther("100"),
      );

      const outcomes = ["Option A", "Option B", "Option C"];
      const openingTime = Number((await client.getBlock({ blockTag: "latest" })).timestamp) + 7 * 24 * 60 * 60;
      await send(
        factory,
        encodeFunctionData({
          abi: app.sessionFactoryAbi,
          functionName: "deploySession",
          args: [
            {
              parent: {
                marketName: `Which options will the prior sDAI fork test pick? (${Date.now()})`,
                outcomes,
                tokenNames: outcomes.map((_, index) => `PRPR_${index}`),
                category: "misc",
                lang: "en",
                minBond: parseEther("1"),
                openingTime,
              },
              children: outcomes.map((name, index) => ({
                parentOutcomeIndex: BigInt(index),
                marketName: `What score will ${name} get?[%]`,
                outcomes: ["DOWN", "UP"],
                tokenNames: [`PRPR_${index}_DOWN`, `PRPR_${index}_UP`],
                lowerBound: 0n,
                upperBound: parseEther("100"),
                minBond: parseEther("1"),
                openingTime,
                category: "misc",
                lang: "en",
              })),
              multiCategoricalParent: true,
              metadataUri: "ipfs://redeem-popup-prior-fork-test",
            },
          ],
        }),
      );
      sessionId =
        (await client.readContract({ address: factory, abi: app.sessionFactoryAbi, functionName: "sessionCount" })) -
        1n;
      const deployed = await client.readContract({
        address: factory,
        abi: app.sessionFactoryAbi,
        functionName: "getSession",
        args: [sessionId],
      });
      const parentMarket = deployed.parentMarket;
      const parentTokens = await Promise.all(
        Array.from({ length: OPTIONS }, async (_, index) => {
          const [token] = await client.readContract({
            address: parentMarket,
            abi: MARKET_ABI,
            functionName: "wrappedOutcome",
            args: [BigInt(index)],
          });
          return token;
        }),
      );
      const calls = [
        ...app.splitCalls({ router, collateral: S_DAI, market: parentMarket, amount: parseEther("9") }),
        ...[parseEther("4"), parseEther("3")].flatMap((amount, index) =>
          app.splitCalls({
            router,
            collateral: S_DAI,
            deposited: parentTokens[index]!,
            market: deployed.childMarkets[index]!,
            amount,
          }),
        ),
      ];
      await sendTx(app.batchExecuteTx(tradeWallet, calls));

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

    const request = () => ({ chainId: CHAIN_ID, owner: OWNER, sessionFactory: factory, sessionId });

    it(
      "the guard passes only the payout, and that batch leaves the prior sDAI in the trade wallet to the wei",
      async () => {
        await inSnapshot(async () => {
          const { plan, scope, payout } = await app.readTradeWalletRedeemToOwner(client, request());
          const prior = await balanceOf(S_DAI, tradeWallet);
          expect(prior).toBeGreaterThan(0n);
          expect(plan.payout).toBeGreaterThan(0n);
          const departures = (tx: FlowTx) =>
            app.ownerPayBatchDepartures({ tx, chainId: CHAIN_ID, account: OWNER, scope, payout });

          expect(departures(plan.tx!)).toEqual([]);
          expect(departures(withAmount(plan.tx!, plan.payout + 1n))).toEqual([
            `transfers ${plan.payout + 1n}, not the payout ${plan.payout}`,
          ]);
          expect(departures(withAmount(plan.tx!, plan.payout - 1n))).toEqual([
            `transfers ${plan.payout - 1n}, not the payout ${plan.payout}`,
          ]);
          const ownerBefore = await balanceOf(S_DAI, OWNER);

          await sendTx(plan.tx!);

          expect((await balanceOf(S_DAI, OWNER)) - ownerBefore).toBe(plan.payout);
          expect(await balanceOf(S_DAI, tradeWallet)).toBe(prior);
        });
      },
      RUN_TIMEOUT_MS,
    );

    it(
      "sent past the guard, a transfer of the payout + 1 does not revert: the prior sDAI pays the 1 wei",
      async () => {
        await inSnapshot(async () => {
          const { plan } = await app.readTradeWalletRedeemToOwner(client, request());
          const prior = await balanceOf(S_DAI, tradeWallet);
          const ownerBefore = await balanceOf(S_DAI, OWNER);

          await sendTx(withAmount(plan.tx!, plan.payout + 1n));

          expect((await balanceOf(S_DAI, OWNER)) - ownerBefore).toBe(plan.payout + 1n);
          expect(await balanceOf(S_DAI, tradeWallet)).toBe(prior - 1n);
        });
      },
      RUN_TIMEOUT_MS,
    );
  },
);
