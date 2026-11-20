// @vitest-environment node
import { execFileSync } from "node:child_process";
import path from "node:path";

import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
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

import type { SessionResolution } from "../getSessionResolution";

/**
 * The resolution read against a real chain: `yarn local-stack gnosis-fork`, then `yarn workspace web test:fork`
 * (its filter selects files by the `predict.fork` substring). The session is resolved by the contracts package's
 * `simulate-resolve` task, whose `gnosis-fork` network is fixed at 127.0.0.1:8545.
 */
const FORK_RPC_URL = process.env.FORK_RPC_URL;
const HARDHAT_FORK_URL = "http://127.0.0.1:8545";
const FORK_RPC_TIMEOUT_MS = 60_000;
const SETUP_TIMEOUT_MS = 900_000;
const READ_TIMEOUT_MS = 300_000;
const CHAIN_ID = 100;
const REPO_ROOT = path.resolve(import.meta.dirname, "../../../../../../..");

const OWNER: Address = "0x1a00000000000000000000000000000000000a12";

const MARKET_ABI = parseAbi([
  "function conditionId() view returns (bytes32)",
  "function realityProxy() view returns (address)",
  "function lowerBound() view returns (uint256)",
  "function upperBound() view returns (uint256)",
]);
const REALITY_PROXY_ABI = parseAbi(["function conditionalTokens() view returns (address)"]);
const CONDITIONAL_TOKENS_ABI = parseAbi([
  "function payoutDenominator(bytes32 conditionId) view returns (uint256)",
  "function payoutNumerators(bytes32 conditionId, uint256 index) view returns (uint256)",
]);

/** The app's modules read validated env when they load, so they come in inside the tests. */
const load = async () => ({
  ...(await import("../getSessionResolution")),
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

describe.skipIf(!FORK_RPC_URL)("the session resolution read, against a gnosis fork", () => {
  let client: PublicClient;
  let wallet: WalletClient;
  let app: App;
  let snapshotId: string;
  let markets: { parentMarket: Address; childMarkets: Address[] };
  let session: { sessionFactory: Address; sessionId: bigint };
  let conditionalTokens: Address;

  const read = <T>(args: Parameters<PublicClient["readContract"]>[0]) => client.readContract(args) as Promise<T>;

  async function send(from: Address, to: Address, data: Hex) {
    const gas = ((await client.estimateGas({ account: from, to, data })) * 3n) / 2n;
    const hash = await wallet.sendTransaction({ account: from, chain: gnosis, to, data, gas });
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`setup transaction to ${to} reverted`);
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

  beforeAll(async () => {
    if (new URL(FORK_RPC_URL!).origin !== new URL(HARDHAT_FORK_URL).origin) {
      throw new Error(`simulate-resolve reaches the fork at ${HARDHAT_FORK_URL}; FORK_RPC_URL is ${FORK_RPC_URL}`);
    }
    const transport = http(FORK_RPC_URL, { timeout: FORK_RPC_TIMEOUT_MS });
    client = createPublicClient({ chain: gnosis, transport, pollingInterval: 100 }) as PublicClient;
    wallet = createWalletClient({ chain: gnosis, transport, pollingInterval: 100 });
    app = await load();
    const factory = app.sessionFactoryAddress(CHAIN_ID);
    if (!factory) throw new Error("This chain is missing the SessionFactory deployment.");

    snapshotId = await rpc<string>("evm_snapshot");
    await rpc("hardhat_impersonateAccount", [OWNER]);
    await rpc("hardhat_setBalance", [OWNER, hex(parseEther("10000"))]);

    const openingTime = Number((await client.getBlock({ blockTag: "latest" })).timestamp) + 7 * 24 * 60 * 60;
    const outcomes = ["Option A", "Option B", "Option C"];
    await send(
      OWNER,
      factory,
      encodeFunctionData({
        abi: app.sessionFactoryAbi,
        functionName: "deploySession",
        args: [
          {
            parent: {
              marketName: `Which options will the resolution fork test pick? (${Date.now()})`,
              outcomes,
              tokenNames: ["RSF_A", "RSF_B", "RSF_C"],
              category: "misc",
              lang: "en",
              minBond: parseEther("1"),
              openingTime,
            },
            children: outcomes.map((label, index) => ({
              parentOutcomeIndex: BigInt(index),
              marketName: `What score will ${label} get?[%]`,
              outcomes: ["DOWN", "UP"],
              tokenNames: [`RSF_${index}_DOWN`, `RSF_${index}_UP`],
              lowerBound: 0n,
              upperBound: parseEther("100"),
              minBond: parseEther("1"),
              openingTime,
              category: "misc",
              lang: "en",
            })),
            multiCategoricalParent: true,
            metadataUri: "ipfs://resolution-fork-test",
          },
        ],
      }),
    );
    const count = await read<bigint>({ address: factory, abi: app.sessionFactoryAbi, functionName: "sessionCount" });
    const sessionId = count - 1n;
    const deployed = await read<{ parentMarket: Address; childMarkets: readonly Address[] }>({
      address: factory,
      abi: app.sessionFactoryAbi,
      functionName: "getSession",
      args: [sessionId],
    });
    markets = { parentMarket: deployed.parentMarket, childMarkets: [...deployed.childMarkets] };
    session = { sessionFactory: factory, sessionId };
    const proxy = await read<Address>({ address: markets.parentMarket, abi: MARKET_ABI, functionName: "realityProxy" });
    conditionalTokens = await read<Address>({
      address: proxy,
      abi: REALITY_PROXY_ABI,
      functionName: "conditionalTokens",
    });

    execFileSync(
      "yarn",
      [
        "simulate:resolve:gnosis-fork",
        "--session",
        sessionId.toString(),
        "--winners",
        "0,1,2",
        "--children",
        "0=42,2=invalid",
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
    "A1 returns the resolved parent, a valued child, an INVALID child and an unresolved child, with the chain's numerators",
    async () => {
      const [valued, waiting, invalid] = markets.childMarkets as [Address, Address, Address];

      const resolution: SessionResolution = await app.fetchSessionResolution(client, session);

      const parent = await chainPayouts(markets.parentMarket, 4);
      expect(parent.payoutNumerators).toEqual([1n, 1n, 1n, 0n]);
      expect(resolution.parent).toMatchObject({
        resolved: true,
        invalid: false,
        winningOutcomes: [0, 1, 2],
        ...parent,
      });

      const valuedPayouts = await chainPayouts(valued, 3);
      const low = await read<bigint>({ address: valued, abi: MARKET_ABI, functionName: "lowerBound" });
      const high = await read<bigint>({ address: valued, abi: MARKET_ABI, functionName: "upperBound" });
      expect(valuedPayouts.payoutNumerators).toEqual([high - parseEther("42"), parseEther("42") - low, 0n]);
      expect(resolution.children[0]).toMatchObject({
        deployed: true,
        market: valued,
        resolved: true,
        invalid: false,
        finalValue: 42,
        ...valuedPayouts,
      });

      const invalidPayouts = await chainPayouts(invalid, 3);
      expect(invalidPayouts.payoutNumerators).toEqual([0n, 0n, 1n]);
      expect(resolution.children[2]).toMatchObject({
        deployed: true,
        market: invalid,
        resolved: true,
        invalid: true,
        finalValue: null,
        ...invalidPayouts,
      });

      expect((await chainPayouts(waiting, 3)).payoutDenominator).toBe(0n);
      expect(resolution.children[1]).toMatchObject({ deployed: true, market: waiting, resolved: false });
      const claims = resolution.children[1] as Record<string, unknown>;
      expect(claims.payoutNumerators ?? null).toBeNull();
      expect(claims.payoutDenominator ?? null).toBeNull();
      expect(claims.finalValue ?? null).toBeNull();
      expect(Object.keys(resolution.children).sort()).toEqual(["0", "1", "2"]);
    },
    READ_TIMEOUT_MS,
  );
});
