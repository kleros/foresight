import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DocumentNode, OperationDefinitionNode } from "graphql";
import {
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  isAddressEqual,
  multicall3Abi,
  parseAbi,
  parseEther,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { gnosis } from "viem/chains";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Q96, sortPair } from "@/features/liquidity/api/__tests__/support/chain";
import { refreshSessionAfterTrade } from "@/features/sessions/api/getSessionStats";

import { fetchGraphql } from "@/lib/graphql/batcher";

import { addresses } from "@/testing/fixtures";

import { MarketPage } from "../MarketPage";
import {
  BRANCH_NAMES,
  createWorld,
  numbersIn,
  precedes,
  S_DAI,
  sessionRow,
  TRADING_CLOSE,
  WAD,
  type World,
} from "./liquidity/support";

/**
 * The market header's Volume, Notional volume and Liquidity, read through what a visitor sees on MarketPage.
 *
 *   Indexer: any query other than SessionDetail and SessionChart is answered with `Prediction` rows
 *   (`executor_id`) and `Pool` rows carrying every Pool field the schema has: `id` (the pool address),
 *   `childMarket { id }` and `childMarket_id`, `outcomeToken`, `underlyingToken`, `outcomeIndex` (0 DOWN, 1 UP),
 *   `outcomeIsToken0`, `underlyingPerOutcome` (1e18-scaled, null until priced), `volumeOutcome`,
 *   `volumeUnderlying`, `price`, `tick`, `liquidity`, `updatedAt`.
 *   Chain: liquidity/support's World. A pool's balances are ERC20 `balanceOf(pool)` on its two tokens;
 *   sDAI's `previewRedeem`/`convertToAssets` give 10/9 xDAI per share. Symbols are side-blind: an UP token's
 *   `symbol()` ends in `_DOWN` and a DOWN token's in `_UP`, so the side comes from the indexer only.
 *
 * Each stat is a button within its labelled stat; its popup is a dialog. Expected figures are worked by hand below.
 */

const current = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock("@/lib/web3/public-client", () => ({
  get publicClient() {
    return current.client;
  },
}));
vi.mock("@/config/chains", async (importOriginal) => {
  const { gnosis: gnosisChain } = await import("viem/chains");
  return {
    ...(await importOriginal<typeof import("@/config/chains")>()),
    DEFAULT_CHAIN_ID: 100,
    DEFAULT_CHAIN: gnosisChain,
  };
});
vi.mock("@/features/sessions/api/verifySession", () => ({
  verifySession: async (_client: unknown, _chain: number, row: unknown) => row,
}));
vi.mock("@/lib/graphql/batcher", () => ({ fetchGraphql: vi.fn() }));
vi.mock("@/config/ipfs", () => ({ IPFS_GATEWAY: "https://cdn.example.link/ipfs" }));
vi.mock("@/features/trade-executor/components/TradeWallet/TradeWallet", () => ({ TradeWallet: () => null }));
vi.mock("@/app/market/[parentMarket]/_components/useOptionPositions", () => ({ useOptionPositions: () => ({}) }));
vi.mock("@/components/wallet/EnsureChain", () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: undefined, chainId: 100, isConnected: false, status: "disconnected" }),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
  usePathname: () => window.location.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

const fetchMock = vi.mocked(fetchGraphql);

vi.setConfig({ testTimeout: 20_000 });

const SESSION_ID = "1";
const POLL_MS = 5_000;
const WAIT = { timeout: 5_000 };

type Side = "UP" | "DOWN";

/** One pool as the indexer and the chain hold it; amounts in whole tokens. */
interface PoolFixture {
  branch: 0 | 1;
  side: Side;
  volumeUnderlying: string;
  volumeOutcome: string;
  /** Underlying per outcome token; null while the pool has not priced. */
  price: string | null;
  outcomeBalance: string;
  underlyingBalance: string;
}

/*
 * Two options, outcomeCount 2: one underlying is 1/2 collateral.
 *   Volume   = (20 + 8 + 5 + 3) / 2                                   = 18
 *   Notional = (30 + 12 + 9 + 3) / 2                                  = 27
 *   Liquidity, per pool outcome × price + underlying:
 *     Villeneuve UP   40 × 0.25 + 12.5 = 22.5
 *     Villeneuve DOWN 20 × 0.75 + 24   = 39
 *     Gerwig UP       unpriced, 4 only = 4      (a 0.5 fallback would add 50)
 *     Gerwig DOWN     10 × 0.5 + 1.5   = 6.5
 *   (22.5 + 39 + 4 + 6.5) / 2                                         = 36
 *   USD at 10/9 xDAI per sDAI: 20, 30, 40.
 */
const BEFORE: PoolFixture[] = [
  {
    branch: 0,
    side: "UP",
    volumeUnderlying: "20",
    volumeOutcome: "30",
    price: "0.25",
    outcomeBalance: "40",
    underlyingBalance: "12.5",
  },
  {
    branch: 0,
    side: "DOWN",
    volumeUnderlying: "8",
    volumeOutcome: "12",
    price: "0.75",
    outcomeBalance: "20",
    underlyingBalance: "24",
  },
  {
    branch: 1,
    side: "UP",
    volumeUnderlying: "5",
    volumeOutcome: "9",
    price: null,
    outcomeBalance: "100",
    underlyingBalance: "4",
  },
  {
    branch: 1,
    side: "DOWN",
    volumeUnderlying: "3",
    volumeOutcome: "3",
    price: "0.5",
    outcomeBalance: "10",
    underlyingBalance: "1.5",
  },
];

/*
 * A prediction buys Villeneuve UP: 4.5 underlying and 21 UP more volume, 22 UP and 17 underlying left, price 0.5.
 *   Volume    (24.5 + 8 + 5 + 3) / 2            = 20.25
 *   Notional  (51 + 12 + 9 + 3) / 2             = 37.5
 *   Liquidity (22 × 0.5 + 17 + 39 + 4 + 6.5) / 2 = 38.75
 */
const AFTER: PoolFixture[] = BEFORE.map((pool) =>
  pool.branch === 0 && pool.side === "UP"
    ? {
        ...pool,
        volumeUnderlying: "24.5",
        volumeOutcome: "51",
        price: "0.5",
        outcomeBalance: "22",
        underlyingBalance: "17",
      }
    : pool,
);

const SYMBOL_ABI = parseAbi(["function symbol() view returns (string)"]);

/** The World's client with each UP token reporting a `_DOWN` symbol and each DOWN token an `_UP` one. */
function sideBlindClient(world: World): PublicClient {
  const misleading = new Map<string, string>();
  world.branches.forEach((branch, index) => {
    misleading.set(branch.upToken.toLowerCase(), `${BRANCH_NAMES[index]}_DOWN`);
    misleading.set(branch.downToken.toLowerCase(), `${BRANCH_NAMES[index]}_UP`);
  });
  const symbolAnswer = (to: Address, data: Hex): Hex | undefined => {
    const symbol = misleading.get(to.toLowerCase());
    if (!symbol) return undefined;
    try {
      decodeFunctionData({ abi: SYMBOL_ABI, data });
    } catch {
      return undefined;
    }
    return encodeFunctionResult({ abi: SYMBOL_ABI, functionName: "symbol", result: symbol });
  };
  const forward = (args: { method: string; params?: unknown }) =>
    world.client.request(args as never) as Promise<unknown>;

  async function request({ method, params }: { method: string; params?: unknown }): Promise<unknown> {
    if (method === "eth_call") {
      const [{ to, data }] = params as [{ to: Address; data: Hex }];
      if (isAddressEqual(to, gnosis.contracts.multicall3.address)) {
        const decoded = decodeFunctionData({ abi: multicall3Abi, data });
        if (decoded.functionName === "aggregate3") {
          const results = await Promise.all(
            decoded.args[0].map(async (call) => {
              const mine = symbolAnswer(call.target, call.callData);
              if (mine) return { success: true, returnData: mine };
              try {
                const returnData = (await forward({
                  method: "eth_call",
                  params: [{ to: call.target, data: call.callData }, "latest"],
                })) as Hex;
                return { success: true, returnData };
              } catch {
                return { success: false, returnData: "0x" as Hex };
              }
            }),
          );
          return encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result: results });
        }
      }
      const mine = symbolAnswer(to, data);
      if (mine) return mine;
    }
    return forward({ method, params });
  }

  return createPublicClient({ chain: gnosis, transport: custom({ request }), batch: { multicall: true } });
}

interface Market {
  world: World;
  state: { traders: number; pools: PoolFixture[] };
  poolAddress: (fixture: Pick<PoolFixture, "branch" | "side">) => Address;
}

function outcomeTokenOf(world: World, { branch, side }: Pick<PoolFixture, "branch" | "side">): Address {
  const tokens = world.branches[branch]!;
  return side === "UP" ? tokens.upToken : tokens.downToken;
}

/** Puts each pool's balances on chain; the pools exist from `createMarket`. */
function holdBalances(market: Market, pools: PoolFixture[]) {
  for (const pool of pools) {
    const address = market.poolAddress(pool);
    market.world.setBalance(outcomeTokenOf(market.world, pool), parseEther(pool.outcomeBalance), address);
    market.world.setBalance(market.world.branches[pool.branch]!.outcome, parseEther(pool.underlyingBalance), address);
  }
}

function createMarket(pools: PoolFixture[], traders: number): Market {
  const world = createWorld();
  const addressByKey = new Map<string, Address>();
  for (const pool of pools) {
    const address = world.setPool(outcomeTokenOf(world, pool), world.branches[pool.branch]!.outcome, {
      sqrtPriceX96: Q96,
      liquidity: 10n * WAD,
      tickSpacing: 60,
    });
    addressByKey.set(`${pool.branch}-${pool.side}`, address);
  }
  const market: Market = {
    world,
    state: { traders, pools },
    poolAddress: ({ branch, side }) => addressByKey.get(`${branch}-${side}`)!,
  };
  holdBalances(market, pools);
  return market;
}

/** The trade lands: the chain moves now, the indexer serves it from its next read. */
function trade(market: Market, pools: PoolFixture[], traders: number) {
  holdBalances(market, pools);
  market.state = { traders, pools };
}

function poolRow(market: Market, pool: PoolFixture) {
  const { world } = market;
  const branch = world.branches[pool.branch]!;
  const outcomeToken = outcomeTokenOf(world, pool);
  return {
    id: market.poolAddress(pool).toLowerCase(),
    childMarket: { id: branch.childMarket },
    childMarket_id: branch.childMarket,
    outcomeToken: outcomeToken.toLowerCase(),
    underlyingToken: branch.outcome.toLowerCase(),
    outcomeIndex: pool.side === "UP" ? 1 : 0,
    outcomeIsToken0: isAddressEqual(sortPair(outcomeToken, branch.outcome)[0], outcomeToken),
    price: String(Q96),
    tick: 0,
    liquidity: String(10n * WAD),
    underlyingPerOutcome: pool.price === null ? null : String(parseEther(pool.price)),
    volumeOutcome: String(parseEther(pool.volumeOutcome)),
    volumeUnderlying: String(parseEther(pool.volumeUnderlying)),
    updatedAt: "1756000000",
  };
}

const queryName = (document: DocumentNode) =>
  document.definitions.find((d): d is OperationDefinitionNode => d.kind === "OperationDefinition")?.name?.value;

/** Pool rows go out branch 2 first and DOWN before UP, so no order can stand in for the side. */
const SERVED_ORDER: Pick<PoolFixture, "branch" | "side">[] = [
  { branch: 1, side: "DOWN" },
  { branch: 1, side: "UP" },
  { branch: 0, side: "DOWN" },
  { branch: 0, side: "UP" },
];

function answerIndexer(market: Market, collateral: { token: Address; symbol: string }) {
  fetchMock.mockImplementation((async (document: DocumentNode) => {
    if (queryName(document) === "SessionDetail") {
      return {
        Session: [
          {
            ...sessionRow(market.world, TRADING_CLOSE),
            collateralToken: collateral.token,
            collateralSymbol: collateral.symbol,
          },
        ],
      };
    }
    // resolves: a refresh awaits the chart refetch it starts
    if (queryName(document) === "SessionChart") return { Pool: [] };
    const { traders, pools } = market.state;
    const trader = (i: number) => `0x${String(i + 1).padStart(40, "0")}`;
    // the last trader swapped on a pool directly, the rest predicted through foresight
    return {
      Prediction: Array.from({ length: traders - 1 }, (_, i) => ({ executor: { owner: trader(i) } })),
      directSwaps: [{ sender: trader(traders - 1) }],
      senderlessSwaps: [],
      Pool: SERVED_ORDER.map((key) => pools.find((pool) => pool.branch === key.branch && pool.side === key.side)!).map(
        (pool) => poolRow(market, pool),
      ),
    };
  }) as never);
}

const SDAI = { token: S_DAI, symbol: "sDAI" };
const NOT_SDAI = { token: addresses.collateralToken, symbol: "GNO" };

function show(market: Market, collateral = SDAI) {
  current.client = sideBlindClient(market.world);
  answerIndexer(market, collateral);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MarketPage parentMarket={market.world.parentMarket} />
    </QueryClientProvider>,
  );
  return { client };
}

const sessionHeader = () => {
  const header = screen.getByRole("heading", { level: 1, name: "Dune: Part Three, director" }).closest("header");
  if (!header) throw new Error("The session title is not inside the page's header.");
  return header as HTMLElement;
};

/** The first header element, deepest first, whose text starts with the stat's label. */
function statLabel(label: string): HTMLElement {
  const header = sessionHeader();
  const starts = (el: Element) => new RegExp(`^${label}\\b`).test((el.textContent ?? "").trim());
  const matching = [...header.querySelectorAll("*")].filter(starts);
  const deepest = matching.find((el) => ![...el.querySelectorAll("*")].some(starts));
  if (!deepest) throw new Error(`Expected a "${label}" stat in the header, found none.`);
  return deepest as HTMLElement;
}

/** The stat: the outermost ancestor of its label whose text still starts with the label. */
function stat(label: string): HTMLElement {
  const header = sessionHeader();
  const starts = (el: Element) => new RegExp(`^${label}\\b`).test((el.textContent ?? "").trim());
  let element = statLabel(label);
  while (element.parentElement && element.parentElement !== header && starts(element.parentElement)) {
    element = element.parentElement;
  }
  return element;
}

function statButton(label: string): HTMLElement {
  const wrapping = statLabel(label).closest<HTMLElement>('button, [role="button"]');
  if (wrapping) return wrapping;
  const buttons = within(stat(label)).queryAllByRole("button");
  if (buttons.length !== 1) throw new Error(`Expected one button in the "${label}" stat, found ${buttons.length}.`);
  return buttons[0]!;
}

/** A regex source for `value` as the page may format it: grouping off, trailing zeros allowed. */
function amount(value: number): string {
  const [whole, fraction] = String(value).split(".");
  return fraction ? `(?<![\\d.])${whole}\\.${fraction}0*(?!\\d)` : `(?<![\\d.])${whole}(?:\\.0+)?(?!\\d)`;
}

const inCollateral = (value: number, symbol = "sDAI") =>
  new RegExp(`~\\s?${amount(value).replace("(?<![\\d.])", "")}\\s*${symbol}`);

async function statsLoaded() {
  await screen.findByRole("heading", { level: 1, name: "Dune: Part Three, director" }, WAIT);
  await waitFor(() => expect(stat("Liquidity")).toHaveTextContent(/\d/), WAIT);
}

async function openPopup(label: string) {
  await statsLoaded();
  await userEvent.click(statButton(label));
  return screen.findByRole("dialog", undefined, WAIT);
}

const side = (word: Side) => new RegExp(`\\b${word}\\b`);

/** The block naming `name`: its nearest ancestor holding both an UP and a DOWN line. */
function optionBlock(dialog: HTMLElement, name: string): HTMLElement {
  const [start] = within(dialog).getAllByText(name, { exact: false });
  let element = start!;
  while (
    element !== dialog &&
    !(side("UP").test(element.textContent ?? "") && side("DOWN").test(element.textContent ?? ""))
  ) {
    element = element.parentElement!;
  }
  expect(element, `${name} has a block of its own with UP and DOWN lines`).not.toBe(dialog);
  for (const other of BRANCH_NAMES.filter((each) => each !== name)) {
    expect(element.textContent, `${name}'s block holds no other option`).not.toContain(other);
  }
  return element;
}

/** The block's line for one side: the outermost element naming that side and not the other. */
function sideLine(block: HTMLElement, word: Side): HTMLElement {
  const other: Side = word === "UP" ? "DOWN" : "UP";
  const candidates = [block, ...block.querySelectorAll<HTMLElement>("*")].filter(
    (el) => side(word).test(el.textContent ?? "") && !side(other).test(el.textContent ?? ""),
  );
  const outermost = candidates.filter((el) => !candidates.some((c) => c !== el && c.contains(el)));
  expect(outermost, `one ${word} line`).toHaveLength(1);
  return outermost[0]!;
}

const shows = (element: HTMLElement, values: number[]) =>
  numbersIn(element).some((n) => values.some((v) => Math.abs(n - v) < 1e-6));

/** The first text in the dialog carrying `total` comes before every option's block. */
function expectTotalOnTop(dialog: HTMLElement, total: number, blocks: HTMLElement[]) {
  const walker = document.createTreeWalker(dialog, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node && !new RegExp(amount(total)).test(node.textContent ?? "")) node = walker.nextNode();
  expect(node, `the dialog shows the total ${total}`).not.toBeNull();
  for (const block of blocks) {
    expect(block.contains(node), "the total is not inside an option's block").toBe(false);
    expect(precedes(node!.parentElement!, block), "the total sits above the option blocks").toBe(true);
  }
}

beforeEach(() => {
  fetchMock.mockReset();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the market header's stats", () => {
  it("shows Traders, Volume, Notional volume and Liquidity, the collateral figures marked approximate", async () => {
    show(createMarket(BEFORE, 3));
    await statsLoaded();

    await waitFor(() => {
      expect(stat("Traders")).toHaveTextContent(/(?<!\d)3(?!\d)/);
      expect(stat("Volume")).toHaveTextContent(inCollateral(18));
      expect(stat("Notional volume")).toHaveTextContent(inCollateral(27));
      expect(stat("Liquidity")).toHaveTextContent(inCollateral(36));
    }, WAIT);
  });

  it("counts an unpriced pool's underlying only, its outcome balance not valued at any fallback price", async () => {
    // only Gerwig UP is unpriced: 100 UP and 4 underlying; at 0.5 Liquidity would read 61, not 36
    show(createMarket(BEFORE, 3));
    await statsLoaded();

    await waitFor(() => expect(stat("Liquidity")).toHaveTextContent(inCollateral(36)), WAIT);
  });
});

describe("the stat popups", () => {
  it.each([
    { label: "Volume", total: 18 },
    { label: "Notional volume", total: 27 },
    { label: "Liquidity", total: 36 },
  ])("$label opens a popup with the total on top and a block per option", async ({ label, total }) => {
    show(createMarket(BEFORE, 3));

    const dialog = await openPopup(label);

    const blocks = BRANCH_NAMES.map((name) => optionBlock(dialog, name));
    for (const block of blocks) {
      expect(sideLine(block, "UP")).toBeInTheDocument();
      expect(sideLine(block, "DOWN")).toBeInTheDocument();
    }
    expectTotalOnTop(dialog, total, blocks);
  });

  it("puts each pool's swapped volume on its own side's line", async () => {
    show(createMarket(BEFORE, 3));

    const dialog = await openPopup("Volume");

    // a line may read in underlying or in collateral (half of it); the other side's figures never appear
    const [villeneuve, gerwig] = BRANCH_NAMES.map((name) => optionBlock(dialog, name)) as [HTMLElement, HTMLElement];
    const cases: [HTMLElement, Side, number[], number[]][] = [
      [villeneuve, "UP", [20, 10], [8, 4]],
      [villeneuve, "DOWN", [8, 4], [20, 10]],
      [gerwig, "UP", [5, 2.5], [3, 1.5]],
      [gerwig, "DOWN", [3, 1.5], [5, 2.5]],
    ];
    for (const [block, word, own, others] of cases) {
      const line = sideLine(block, word);
      expect(shows(line, own), `${word} line ${line.textContent}`).toBe(true);
      expect(shows(line, others), `${word} line ${line.textContent}`).toBe(false);
    }
  });

  it("puts each pool's outcome-token volume on its own side's line", async () => {
    show(createMarket(BEFORE, 3));

    const dialog = await openPopup("Notional volume");

    const [villeneuve, gerwig] = BRANCH_NAMES.map((name) => optionBlock(dialog, name)) as [HTMLElement, HTMLElement];
    const cases: [HTMLElement, Side, number[], number[]][] = [
      [villeneuve, "UP", [30, 15], [12, 6]],
      [villeneuve, "DOWN", [12, 6], [30, 15]],
      [gerwig, "UP", [9, 4.5], [3, 1.5]],
      [gerwig, "DOWN", [3, 1.5], [9, 4.5]],
    ];
    for (const [block, word, own, others] of cases) {
      const line = sideLine(block, word);
      expect(shows(line, own), `${word} line ${line.textContent}`).toBe(true);
      expect(shows(line, others), `${word} line ${line.textContent}`).toBe(false);
    }
  });

  it("reads each pool's balances on the side the indexer gives it, whichever token is token0", async () => {
    // in both options the UP pool holds its outcome token as token1 and the DOWN pool as token0
    show(createMarket(BEFORE, 3));

    const dialog = await openPopup("Liquidity");

    const [villeneuve, gerwig] = BRANCH_NAMES.map((name) => optionBlock(dialog, name)) as [HTMLElement, HTMLElement];
    const line = (n: number, word: Side, m: number) =>
      new RegExp(`${amount(n)}\\s*${word}\\s*/\\s*${amount(m)}\\s*underlying`, "i");
    expect(sideLine(villeneuve, "UP")).toHaveTextContent(line(40, "UP", 12.5));
    expect(sideLine(villeneuve, "DOWN")).toHaveTextContent(line(20, "DOWN", 24));
    expect(sideLine(gerwig, "DOWN")).toHaveTextContent(line(10, "DOWN", 1.5));
  });

  it("marks the pool that has not priced yet on its line", async () => {
    show(createMarket(BEFORE, 3));

    const dialog = await openPopup("Liquidity");

    const [villeneuve, gerwig] = BRANCH_NAMES.map((name) => optionBlock(dialog, name)) as [HTMLElement, HTMLElement];
    expect(sideLine(gerwig, "UP")).toHaveTextContent(/not priced yet/i);
    expect(sideLine(gerwig, "DOWN")).not.toHaveTextContent(/not priced yet/i);
    expect(sideLine(villeneuve, "UP")).not.toHaveTextContent(/not priced yet/i);
    expect(sideLine(villeneuve, "DOWN")).not.toHaveTextContent(/not priced yet/i);
  });
});

describe("the USD line", () => {
  it.each([
    { label: "Volume", usd: 20 },
    { label: "Notional volume", usd: 30 },
    { label: "Liquidity", usd: 40 },
  ])("$label's popup gives the total in USD on an sDAI session", async ({ label, usd }) => {
    show(createMarket(BEFORE, 3), SDAI);

    const dialog = await openPopup(label);

    expect(dialog).toHaveTextContent(new RegExp(`\\$\\s?${amount(usd).replace("(?<![\\d.])", "")}`));
  });

  it.each(["Volume", "Notional volume", "Liquidity"])(
    "%s's popup gives no USD figure where the collateral is not sDAI",
    async (label) => {
      show(createMarket(BEFORE, 3), NOT_SDAI);

      const dialog = await openPopup(label);

      await waitFor(() => expect(stat(label)).toHaveTextContent(/GNO/), WAIT);
      expect(dialog.textContent).not.toMatch(/\$|USD/);
      expect(sessionHeader().textContent).not.toMatch(/\$|USD/);
    },
  );
});

describe("after a prediction lands", () => {
  it("refreshes Volume, Notional volume and Liquidity with Traders", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const market = createMarket(BEFORE, 3);
    const { client } = show(market);
    await statsLoaded();
    await waitFor(() => expect(stat("Notional volume")).toHaveTextContent(inCollateral(27)), WAIT);
    await waitFor(() => expect(stat("Liquidity")).toHaveTextContent(inCollateral(36)), WAIT);

    trade(market, AFTER, 4);
    const done = refreshSessionAfterTrade(client, SESSION_ID);
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 13));
    await done;

    await waitFor(() => {
      expect(stat("Traders")).toHaveTextContent(/(?<!\d)4(?!\d)/);
      expect(stat("Volume")).toHaveTextContent(inCollateral(20.25));
      expect(stat("Notional volume")).toHaveTextContent(inCollateral(37.5));
      expect(stat("Liquidity")).toHaveTextContent(inCollateral(38.75));
    }, WAIT);
  });
});
