import { gnosis as contracts } from "@foresight/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DocumentNode, OperationDefinitionNode } from "graphql";
import {
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  isAddressEqual,
  multicall3Abi,
  numberToHex,
  parseAbi,
  RpcRequestError,
  zeroHash,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { gnosis } from "viem/chains";
import { expect } from "vitest";

import { createChain, LIST, owner } from "@/features/liquidity/api/__tests__/support/chain";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";

import { MarketPage } from "../../MarketPage";

/**
 * The market page these tests hold the liquidity UI to, read through what a visitor sees.
 *
 *   MarketPage (app/market/[parentMarket]/_components/MarketPage.tsx)
 *     reads the session's pools with `useLiquidityPools({ parentMarket, childMarkets })`, childMarkets[i] the
 *     child of parent outcome i, and the wallet's positions with `useLiquidityPositions`; every chain read goes
 *     through `publicClient` from "@/lib/web3/public-client", the account through wagmi's `useAccount`;
 *     there is no WagmiProvider, so sends go through `@wagmi/core` with `wagmiConfig` as `usePredictRun` does.
 *     - no pool of the session holds liquidity: a banner above the options with an "Add liquidity" control
 *     - always: a liquidity section below the options and the Predict button, with an "Add liquidity" control
 *       and a line saying how many positions the wallet holds; where it holds any, or complete sets to merge,
 *       a "Your positions" button opens a dialog of that name with one "Remove" per position and a "Merge"
 *       button with what merging returns. The section lists no position itself.
 *     - after the session's close: every "Add liquidity" / "Seed liquidity" control disabled, its reason as
 *       its accessible description; "Remove" and "Merge" stay enabled
 *     - "Add liquidity" opens a dialog named /liquidity/i: a "Total" amount in sDAI or xDAI, per branch a
 *       field named /depth/i (defaults to the total, editable down) and one named /price/i (UP's price,
 *       0.5 by default; disabled or read-only with a note saying it is locked where the pool holds liquidity),
 *       per pool the tokens it receives, what stays in the wallet, and the steps in the house timeline.
 *     - the "Seed liquidity" link on a deployed session's DeployStep opens this page with that dialog open.
 *
 * Expected amounts come from the frozen `flow/plan.ts` (`planSeed`, `planMerge`), never from the components.
 * These tests render the route, so they live in the app layer; `components/` keeps their paths under the
 * `test liquidity/components` filter, `session-create.*` under `test session-create`.
 *
 * The chain behind `publicClient` is api/__tests__/support/chain.ts plus: `eth_blockNumber`,
 * `eth_getBlockByNumber`, `eth_getBalance`, `eth_getTransactionCount`, and ERC20 `balanceOf`, `allowance`,
 * `decimals`, `symbol`, `name` on the session's tokens, and sDAI's `previewDeposit`/`convertToShares` (0.9 shares
 * per xDAI) and `previewRedeem`/`convertToAssets` (its inverse).
 */

export const WAD = 10n ** 18n;

/** The session's two branches, in parent-outcome order. */
export const BRANCH_NAMES = ["Denis Villeneuve", "Greta Gerwig"] as const;

/** Closes on 1 January 2100, so the session is trading whatever the wall clock reads. */
export const TRADING_CLOSE = "4102444800";
/** 2025-09-03, so the session has closed. */
export const PAST_CLOSE = "1756900800";

const TOKEN_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function previewDeposit(uint256 assets) view returns (uint256)",
  "function convertToShares(uint256 assets) view returns (uint256)",
  "function previewRedeem(uint256 shares) view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
]);

/** The session's collateral as the pools read takes it. */
export const S_DAI: Address = contracts.savingsXDaiAddress[100]!;

/** The api fake chain with two branches, the wallet's token balances and the block reads a run makes. */
export function createWorld() {
  const chain = createChain(2);
  const balances = new Map<string, bigint>();
  const chainTime = BigInt(Math.floor(Date.now() / 1000));
  const tokens = new Set(
    [
      S_DAI,
      chain.parentInvalid,
      ...chain.branches.flatMap((each) => [each.outcome, each.upToken, each.downToken, each.invalidToken]),
    ].map((each) => each.toLowerCase()),
  );
  const symbolOf = (token: Address) => {
    if (isAddressEqual(token, S_DAI)) return "sDAI";
    const index = chain.branches.findIndex((each) =>
      [each.outcome, each.upToken, each.downToken, each.invalidToken].some((t) => isAddressEqual(t, token)),
    );
    const branch = chain.branches[index];
    if (!branch) return "INVALID";
    if (isAddressEqual(token, branch.upToken)) return `${BRANCH_NAMES[index]}_UP`;
    if (isAddressEqual(token, branch.downToken)) return `${BRANCH_NAMES[index]}_DOWN`;
    if (isAddressEqual(token, branch.invalidToken)) return "INVALID";
    return BRANCH_NAMES[index]!;
  };

  function tokenAnswer(to: Address, data: Hex): Hex | undefined {
    if (isAddressEqual(to, LIST.positionManager) || !tokens.has(to.toLowerCase())) return undefined;
    let decoded;
    try {
      decoded = decodeFunctionData({ abi: TOKEN_ABI, data });
    } catch {
      return undefined;
    }
    const { functionName, args = [] } = decoded;
    const result = (() => {
      switch (functionName) {
        case "balanceOf":
          return balances.get(`${to}|${args[0] as Address}`.toLowerCase()) ?? 0n;
        case "allowance":
          return 0n;
        case "decimals":
          return 18;
        case "symbol":
        case "name":
          return symbolOf(to);
        case "previewDeposit":
        case "convertToShares":
          return ((args[0] as bigint) * 9n) / 10n;
        case "previewRedeem":
        case "convertToAssets":
          return ((args[0] as bigint) * 10n) / 9n;
      }
    })();
    return encodeFunctionResult({ abi: TOKEN_ABI, functionName, result } as never);
  }

  const reverted = (method: string, params: unknown) =>
    new RpcRequestError({ body: { method, params }, error: { code: 3, message: "execution reverted" }, url: "fake" });

  async function call(to: Address, data: Hex): Promise<Hex> {
    const mine = tokenAnswer(to, data);
    if (mine) return mine;
    return (await chain.client.request({ method: "eth_call", params: [{ to, data }, "latest"] } as never)) as Hex;
  }

  const block = () => ({
    number: "0x2710",
    hash: `0x${"11".repeat(32)}`,
    parentHash: zeroHash,
    nonce: "0x0000000000000000",
    sha3Uncles: zeroHash,
    logsBloom: `0x${"00".repeat(256)}`,
    transactionsRoot: zeroHash,
    stateRoot: zeroHash,
    receiptsRoot: zeroHash,
    miner: "0x0000000000000000000000000000000000000000",
    difficulty: "0x0",
    totalDifficulty: "0x0",
    extraData: "0x",
    size: "0x0",
    gasLimit: "0x1c9c380",
    gasUsed: "0x0",
    timestamp: numberToHex(chainTime),
    baseFeePerGas: "0x1",
    mixHash: zeroHash,
    transactions: [],
    uncles: [],
  });

  async function request({ method, params }: { method: string; params?: unknown }): Promise<unknown> {
    switch (method) {
      case "eth_chainId":
        return "0x64";
      case "eth_blockNumber":
        return "0x2710";
      case "eth_getBlockByNumber":
        return block();
      case "eth_getBalance":
        return numberToHex(100n * WAD);
      case "eth_getTransactionCount":
        return "0x0";
      case "eth_call": {
        const [{ to, data }] = params as [{ to: Address; data: Hex }];
        if (isAddressEqual(to, gnosis.contracts.multicall3.address)) {
          const decoded = decodeFunctionData({ abi: multicall3Abi, data });
          if (decoded.functionName !== "aggregate3") throw new Error(`unexpected multicall ${decoded.functionName}`);
          if (decoded.args[0].some((each) => chain.isRefused(each.callData))) {
            throw new RpcRequestError({
              body: { method, params },
              error: { code: -32000, message: "out of gas" },
              url: "fake",
            });
          }
          const results = await Promise.all(
            decoded.args[0].map(async (each) => {
              try {
                return { success: true, returnData: await call(each.target, each.callData) };
              } catch {
                return { success: false, returnData: "0x" as Hex };
              }
            }),
          );
          return encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result: results });
        }
        try {
          return await call(to, data);
        } catch {
          throw reverted(method, params);
        }
      }
    }
    throw new Error(`unexpected rpc ${method}`);
  }

  const client: PublicClient = createPublicClient({
    chain: gnosis,
    transport: custom({ request }),
    batch: { multicall: true },
  });

  return {
    ...chain,
    client,
    chainTime,
    setBalance(token: Address, amount: bigint, account: Address = owner) {
      balances.set(`${token}|${account}`.toLowerCase(), amount);
    },
  };
}

export type World = ReturnType<typeof createWorld>;

const queryName = (document: DocumentNode) =>
  document.definitions.find((d): d is OperationDefinitionNode => d.kind === "OperationDefinition")?.name?.value;

/** The session's indexer row: the world's parent market and its two branches. */
export function sessionRow(world: World, openingTime: string) {
  return {
    ...sessionDetailColumns,
    parentMarket: world.parentMarket,
    openingTime,
    children: world.branches.map((branch, index) =>
      sessionChildRow({
        id: branch.childMarket,
        parentOutcomeIndex: String(index),
        parentOutcome: BRANCH_NAMES[index]!.split(" ")[1]!,
        displayName: BRANCH_NAMES[index]!,
        upToken: branch.upToken,
        downToken: branch.downToken,
        invalidToken: branch.invalidToken,
      }),
    ),
  };
}

/** Answers the indexer: the session row, a chart that never loads, nothing else. */
export function graphqlFor(world: World, openingTime: string) {
  return async (document: DocumentNode) => {
    if (queryName(document) === "SessionDetail") return { Session: [sessionRow(world, openingTime)] };
    if (queryName(document) === "SessionChart") return new Promise(() => {});
    return { Prediction: [], Pool: [] };
  };
}

export function renderMarketPage(world: World) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MarketPage parentMarket={world.parentMarket} />
    </QueryClientProvider>,
  );
}

export const sessionLoaded = () =>
  screen.findByRole("heading", { level: 1, name: "Dune: Part Three, director" }, { timeout: 5000 });

/** Every "Add liquidity" or "Seed liquidity" control on the page, buttons and links, in document order. */
export function addControls(scope: HTMLElement = document.body): HTMLElement[] {
  const name = /^(add|seed) liquidity$/i;
  const found = [
    ...within(scope).queryAllByRole("button", { name }),
    ...within(scope).queryAllByRole("link", { name }),
  ];
  return found.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
}

export const precedes = (a: Element, b: Element) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

export const liquidityDialog = () => screen.findByRole("dialog", { name: /liquidity/i }, { timeout: 5000 });

export async function openDialog() {
  const controls = addControls();
  const last = controls[controls.length - 1];
  if (!last) throw new Error("No Add liquidity control on the page.");
  await userEvent.click(last);
  return liquidityDialog();
}

const FIELD_ROLES = ["textbox", "spinbutton", "slider"] as const;

/** The dialog's form fields whose accessible name matches, in document order. */
export function fields(scope: HTMLElement, name: RegExp): HTMLElement[] {
  return FIELD_ROLES.flatMap((role) => within(scope).queryAllByRole(role, { name })).sort((a, b) =>
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  );
}

/** A field's value as a number, whatever its widget. */
export function valueOf(field: HTMLElement): number {
  const raw =
    field instanceof HTMLInputElement ? field.value : (field.getAttribute("aria-valuenow") ?? field.textContent ?? "");
  return Number(raw.replace(/,/g, "").replace(/%$/, ""));
}

export async function setField(field: HTMLElement, value: string) {
  if (field instanceof HTMLInputElement && field.type === "range") {
    fireEvent.change(field, { target: { value } });
    return;
  }
  await userEvent.clear(field);
  await userEvent.type(field, value);
  await userEvent.tab();
}

export const isLocked = (field: HTMLElement) =>
  field.hasAttribute("disabled") ||
  field.hasAttribute("readonly") ||
  field.getAttribute("aria-disabled") === "true" ||
  field.getAttribute("aria-readonly") === "true";

/** Every number written in the element's text, grouping commas dropped. */
export function numbersIn(element: HTMLElement): number[] {
  return [...(element.textContent ?? "").matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => Number(m[0].replace(/,/g, "")));
}

const asNumber = (wei: bigint) => Number(wei) / 1e18;

/** `amount` is written in the element, to four significant places, whatever the formatting. */
export function expectShown(element: HTMLElement, amount: bigint, what: string) {
  const expected = asNumber(amount);
  const shown = numbersIn(element);
  const close = shown.some((n) => Math.abs(n - expected) <= Math.max(expected * 1e-4, 1e-4));
  expect(close, `${what}: ${expected} among ${shown.join(" ")}`).toBe(true);
}
