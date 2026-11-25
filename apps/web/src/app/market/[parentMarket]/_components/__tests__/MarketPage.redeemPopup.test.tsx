import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DocumentNode, OperationDefinitionNode } from "graphql";
import { isAddressEqual, type Address } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchRealisedPnl } from "@/features/resolution/api/getRealisedPnl";
import {
  fetchSessionResolution,
  type ChildResolution,
  type ParentResolution,
  type SessionResolution,
  type SessionResolutionRequest,
} from "@/features/resolution/api/getSessionResolution";
import { fetchTradeWalletRedeem } from "@/features/resolution/api/getTradeWalletRedeem";
import { fetchWalletRedeemInput } from "@/features/resolution/api/getWalletRedeem";
import { sharedLocks } from "@/features/resolution/redeem/__tests__/support/locks";
import { plannerInput, WAD } from "@/features/resolution/redeem/__tests__/support/session";
import type { RedeemPlan, WalletRedeemInput } from "@/features/resolution/redeem/plan";
import type { OptionRealisedPnl, RealisedPnl } from "@/features/resolution/utils/realisedPnl";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";

import { fetchGraphql } from "@/lib/graphql/batcher";
import { executorAddress } from "@/lib/trade-executor/executor";

import { tradeExecutorFactoryAddress } from "@/config/contracts";

import { addresses } from "@/testing/fixtures";

import { MarketPage } from "../MarketPage";

/**
 * Spec D11 and D12: one Redeem button opens a popup that lists both wallets' redeemable parts and redeems both.
 * Handles these tests name:
 * - the page's button is a `button` named "Redeem", then the amount it redeems (spec D18); the popup is a `dialog`, closed by its "Close" button;
 * - in the popup each wallet's parts and waiting options are the `listitem`s of a `list` named by its wallet:
 *   /trade wallet/i for the trade wallet, /(your|connected) wallet/i (without "trade") for the connected wallet;
 *   a child part's row names its option;
 * - P&L reads as a signed sDAI amount with two decimals, read out with "profit" or "loss" (spec D21);
 * - the pay-to-owner box is the popup's one `checkbox`; the owner address is the trade wallet's `owner()`, read
 *   through `publicClient` (`readContract` or `multicall`), shown in full.
 */
vi.mock("@/features/resolution/api/getRealisedPnl", () => ({ fetchRealisedPnl: vi.fn() }));
vi.mock("@/features/resolution/api/getSessionResolution", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/resolution/api/getSessionResolution")>()),
  fetchSessionResolution: vi.fn(),
}));
vi.mock("@/features/resolution/api/getTradeWalletRedeem", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/resolution/api/getTradeWalletRedeem")>()),
  fetchTradeWalletRedeem: vi.fn(),
  readTradeWalletRedeem: vi.fn(),
}));
vi.mock("@/features/resolution/api/getWalletRedeem", () => ({ fetchWalletRedeemInput: vi.fn() }));
vi.mock("@/config/chains", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/chains")>()),
  DEFAULT_CHAIN_ID: 100,
}));
vi.mock("@/lib/web3/public-client", () => ({
  publicClient: {
    readContract: async (call: ChainCall) => chainRead(call),
    multicall: async ({ contracts, allowFailure }: { contracts: ChainCall[]; allowFailure?: boolean }) =>
      Promise.all(
        contracts.map(async (call) => {
          if (allowFailure === false) return chainRead(call);
          try {
            return { status: "success", result: await chainRead(call) };
          } catch (error) {
            return { status: "failure", error };
          }
        }),
      ),
  },
}));
vi.mock("@/config/contracts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/contracts")>()),
  sessionFactoryAddress: () => "0x5f00000000000000000000000000000000000000",
}));
vi.mock("@/features/liquidity/api/getLiquidityPools", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/liquidity/api/getLiquidityPools")>()),
  useLiquidityPools: () => ({ data: undefined, isError: false }),
}));
vi.mock("@/features/sessions/api/verifySession", () => ({
  verifySession: async (_client: unknown, _chain: number, row: unknown) => row,
}));
vi.mock("@/lib/graphql/batcher", () => ({ fetchGraphql: vi.fn() }));
vi.mock("@/config/ipfs", () => ({ IPFS_GATEWAY: "https://cdn.example.link/ipfs" }));
vi.mock("@/features/trade-executor/components/TradeWallet/TradeWallet", () => ({ TradeWallet: () => null }));
vi.mock("../useOptionPositions", () => ({ useOptionPositions: () => ({}) }));
vi.mock("@/components/wallet/EnsureChain", () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: OWNER, chainId: 100 }),
}));

interface ChainCall {
  address: Address;
  functionName: string;
  args?: readonly unknown[];
}

const OWNER = "0x1a01000000000000000000000000000000000000" as Address;
const TRADE_WALLET = executorAddress(tradeExecutorFactoryAddress(100)!, OWNER);
/** Two answers of the trade wallet's `owner()`; the second is not the connected account, so only the chain names it. */
const ONCHAIN_OWNERS = [OWNER, "0x0A22000000000000000000000000000000000Bc7" as Address] as const;

const chain: { owner: Address; children: Record<number, ChildResolution> } = {
  owner: OWNER,
  children: {},
};

/** The trade wallet's `owner()`; the page's other chain reads are mocked above them. */
function chainRead({ address, functionName }: ChainCall): unknown {
  if (functionName === "owner" && isAddressEqual(address, TRADE_WALLET)) return chain.owner;
  throw new Error(`unexpected read ${functionName} on ${address}`);
}

const fetchMock = vi.mocked(fetchGraphql);
const readerMock = vi.mocked(fetchSessionResolution);
const tradeMock = vi.mocked(fetchTradeWalletRedeem);
const walletMock = vi.mocked(fetchWalletRedeemInput);
const pnlMock = vi.mocked(fetchRealisedPnl);

/** `units` hundredths of an sDAI. */
const cents = (units: number) => (BigInt(units) * WAD) / 100n;

const TITLE = "Dune: Part Three, director";
const THIRD_CHILD = "0xdddddddddddddddddddddddddddddddddddddddd" as Address;
const OPTIONS = [
  { index: 0, name: "Denis Villeneuve", market: addresses.childMarkets[0] },
  { index: 1, name: "Greta Gerwig", market: addresses.childMarkets[1] },
  { index: 2, name: "Christopher Nolan", market: THIRD_CHILD },
] as const;
const [VILLENEUVE, GERWIG, NOLAN] = OPTIONS;

/** Villeneuve and Gerwig won; Nolan was not selected. */
const TWO_WINNERS: ParentResolution = {
  resolved: true,
  invalid: false,
  winningOutcomes: [0, 1],
  payoutNumerators: [1n, 1n, 0n, 0n],
  payoutDenominator: 2n,
};
const resolvedChild = (market: Address): ChildResolution => ({
  deployed: true,
  market,
  resolved: true,
  invalid: false,
  finalValue: 42,
  payoutNumerators: [58n, 42n, 0n],
  payoutDenominator: 100n,
});
const unresolvedChild = (market: Address): ChildResolution => ({ deployed: true, market, resolved: false });

async function answer(request: SessionResolutionRequest): Promise<SessionResolution> {
  const outcomes = request.parentOutcomes ?? OPTIONS.map(({ index }) => index);
  return {
    parent: TWO_WINNERS,
    children: Object.fromEntries(
      outcomes.map((index) => [index, chain.children[index] ?? unresolvedChild(OPTIONS[index]!.market)]),
    ),
  };
}

/** Villeneuve's child pays 12.25 and the parent part 1.50; Gerwig waits for its child's result. */
const TRADE_PLAN: RedeemPlan = {
  parts: [
    { market: VILLENEUVE.market, payout: cents(1225) },
    { market: addresses.parentMarket, payout: cents(150) },
  ],
  waiting: [GERWIG.index],
  payout: cents(1375),
  tx: { to: TRADE_WALLET, data: "0x" },
};
const NOTHING_IN_TRADE_WALLET: RedeemPlan = { parts: [], waiting: [], payout: 0n, tx: null };

/** The connected wallet holds 4 of Villeneuve's parent token: it pays 2 sDAI. */
const walletInput = (balance: bigint): WalletRedeemInput => ({
  ...plannerInput({ owner: OWNER, parentBalances: [balance, 0n, 0n, 0n], childBalances: [] }),
  parentMarket: addresses.parentMarket,
});
const WALLET_HOLDS = walletInput(4n * WAD);
const NOTHING_IN_WALLET = walletInput(0n);

const settled = (cost: bigint, payout: bigint): OptionRealisedPnl => ({
  status: "settled",
  cost,
  payout,
  pnl: payout - cost,
});
/** Villeneuve +7.25, Gerwig waiting, Nolan -4.75: the session reads +2.50. */
const PNL: RealisedPnl = {
  options: {
    0: settled(cents(500), cents(1225)),
    1: { status: "waiting", cost: cents(350) },
    2: settled(cents(475), 0n),
  },
  session: { cost: cents(975), payout: cents(1225), pnl: cents(250), waiting: [1] },
};

const queryName = (document: DocumentNode) =>
  document.definitions.find((d): d is OperationDefinitionNode => d.kind === "OperationDefinition")?.name?.value;

beforeEach(() => {
  Object.defineProperty(navigator, "locks", { configurable: true, value: sharedLocks().locks });
  window.localStorage.clear();
  chain.owner = OWNER;
  chain.children = { 0: resolvedChild(VILLENEUVE.market) };
  readerMock.mockReset();
  readerMock.mockImplementation((_client, request) => answer(request));
  tradeMock.mockReset();
  tradeMock.mockResolvedValue(TRADE_PLAN);
  walletMock.mockReset();
  walletMock.mockResolvedValue(WALLET_HOLDS);
  pnlMock.mockReset();
  pnlMock.mockResolvedValue(PNL);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (document) => {
    if (queryName(document) === "SessionDetail") {
      const children = OPTIONS.map(({ index, name, market }) =>
        sessionChildRow({ id: market, parentOutcomeIndex: String(index), parentOutcome: name, displayName: name }),
      );
      // opened 2025-09-03, so the resolution date has passed
      return {
        Session: [
          { ...sessionDetailColumns, outcomeCount: "3", deployedChildCount: "3", openingTime: "1756900800", children },
        ],
      };
    }
    return { Prediction: [], directSwaps: [], senderlessSwaps: [], Pool: [] };
  });
});

afterEach(() => {
  Reflect.deleteProperty(navigator, "locks");
});

async function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page = () => (
    <QueryClientProvider client={client}>
      <MarketPage parentMarket={addresses.parentMarket} />
    </QueryClientProvider>
  );
  const { rerender } = render(page());
  await screen.findByRole("heading", { level: 1, name: TITLE });
  await waitFor(() => expect(readerMock).toHaveBeenCalled());
  await act(async () => {
    await Promise.all(readerMock.mock.results.map(({ value }) => value));
  });
  await waitFor(() => expect(tradeMock).toHaveBeenCalled());
  await waitFor(() => expect(walletMock).toHaveBeenCalled());
  await act(async () => {
    await Promise.all([...tradeMock.mock.results, ...walletMock.mock.results].map(({ value }) => value));
  });
  /** Refetches every read and renders the page again, as after a redeem settles. */
  const reread = async () => {
    await act(async () => {
      await client.invalidateQueries();
    });
    rerender(page());
  };
  return { reread };
}

/** The page's Redeem button, labelled with the amount: `Redeem 15.75 sDAI`. */
const redeemButtons = () => screen.queryAllByRole("button", { name: /^Redeem( |$)/ });
/** `hidden`, since an open popup hides the page behind it from the accessibility tree. */
const header = () =>
  screen.getByRole("heading", { level: 1, name: TITLE, hidden: true }).closest("header") as HTMLElement;

function expectNoRedeemSection() {
  expect(screen.queryByRole("region", { name: /redeem/i })).toBeNull();
  expect(screen.queryByRole("heading", { name: /^Redeem from your (trade )?wallet$/ })).toBeNull();
}

async function openPopup() {
  await waitFor(() => expect(redeemButtons()).toHaveLength(1));
  await userEvent.click(redeemButtons()[0]!);
  return screen.findByRole("dialog");
}

const tradeList = (dialog: HTMLElement) => within(dialog).getByRole("list", { name: /trade wallet/i });
function connectedList(dialog: HTMLElement) {
  const lists = within(dialog)
    .getAllByRole("list", { name: /(your|connected) wallet/i })
    .filter((list) => !/trade/i.test(list.getAttribute("aria-label") ?? list.textContent ?? ""));
  expect(lists).toHaveLength(1);
  return lists[0]!;
}
function row(list: HTMLElement, text: string | RegExp) {
  const found = within(list)
    .getAllByRole("listitem")
    .filter((item) =>
      typeof text === "string" ? item.textContent?.includes(text) : text.test(item.textContent ?? ""),
    );
  expect(found, `the row with ${String(text)}`).toHaveLength(1);
  return found[0]!;
}

const MINUS = "[-−]\\s*";
const negative = (amount: string) => new RegExp(`${MINUS}${amount.replace(".", "\\.")}`);
/** How a shown P&L is read out (spec D21). */
const PNL_WORD = /profit|loss/;
const positive = (amount: string) => new RegExp(`(^|[^-−\\d.])\\+?\\s*${amount.replace(".", "\\.")}`);
/** `amount` in sDAI at any number of decimals: "1.5" matches "1.50 sDAI", "2" matches "2 sDAI" and "2.00 sDAI". */
function sdai(amount: string) {
  const [whole, fraction = ""] = amount.split(".");
  return new RegExp(`(^|[^\\d.,])${whole}${fraction ? `\\.${fraction}0*` : "(\\.0*)?"}\\s*sDAI`);
}

describe("MarketPage A1 one Redeem button once anything is redeemable, and no Redeem section", () => {
  it("shows one Redeem button when only the trade wallet holds something redeemable", async () => {
    walletMock.mockResolvedValue(NOTHING_IN_WALLET);
    await renderPage();

    await waitFor(() => expect(redeemButtons()).toHaveLength(1));
    expectNoRedeemSection();
  });

  it("shows one Redeem button when only the connected wallet holds something redeemable", async () => {
    tradeMock.mockResolvedValue(NOTHING_IN_TRADE_WALLET);
    await renderPage();

    await waitFor(() => expect(redeemButtons()).toHaveLength(1));
    expectNoRedeemSection();
  });

  it("shows one Redeem button when both wallets hold something redeemable", async () => {
    await renderPage();

    await waitFor(() => expect(redeemButtons()).toHaveLength(1));
    expectNoRedeemSection();
  });

  it("shows no Redeem button when neither wallet holds anything redeemable", async () => {
    tradeMock.mockResolvedValue(NOTHING_IN_TRADE_WALLET);
    walletMock.mockResolvedValue(NOTHING_IN_WALLET);
    await renderPage();
    await act(async () => {});

    expect(redeemButtons()).toHaveLength(0);
    expectNoRedeemSection();
  });
});

describe("MarketPage A12 the Redeem button sits in the session header beside the P&L (spec D18)", () => {
  it("labels the header's button with what both wallets redeem, and puts no Redeem lower on the page", async () => {
    await renderPage();

    await waitFor(() => expect(redeemButtons()).toHaveLength(1));
    const trigger = within(header()).getByRole("button", { name: "Redeem 15.75 sDAI" });
    // the P&L and the button are items of one row
    const pnl = within(header()).getByText("+2.50 sDAI").closest("div")!;
    expect(pnl.parentElement).toBe(trigger.closest("div")!.parentElement);
    const predict = screen.getByRole("heading", { name: "Place your estimates" });
    expect(predict.compareDocumentPosition(trigger) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });
});

describe("MarketPage A2 the popup lists both wallets' parts with payout and P&L, the session total and waiting", () => {
  it("labels each wallet's parts, shows each payout, the trade wallet's P&L, the total and the waiting option", async () => {
    await renderPage();
    const dialog = await openPopup();

    const trade = tradeList(dialog);
    const villeneuve = row(trade, VILLENEUVE.name);
    expect(villeneuve).toHaveTextContent(sdai("12.25"));
    expect(villeneuve).toHaveTextContent(PNL_WORD);
    expect(villeneuve).toHaveTextContent(positive("7.25"));
    expect(row(trade, sdai("1.5"))).toBeInTheDocument();
    expect(row(trade, GERWIG.name)).toHaveTextContent("Waiting for result");
    expect(within(trade).queryByText(new RegExp(NOLAN.name))).toBeNull();

    const connected = connectedList(dialog);
    const walletRow = row(connected, sdai("2"));
    expect(walletRow).not.toHaveTextContent(PNL_WORD);
    expect(connected).not.toHaveTextContent("12.25");

    expect(dialog).toHaveTextContent(PNL_WORD);
    expect(dialog).toHaveTextContent(positive("2.50"));
    expect(dialog).not.toHaveTextContent(negative("2.50"));
  });
});

describe("MarketPage A10 the pay-to-owner box shows the trade wallet's owner and is off on every open", () => {
  for (const owner of ONCHAIN_OWNERS) {
    it(`shows owner() read from the trade wallet once ticked, for owner ${owner}`, async () => {
      chain.owner = owner;
      await renderPage();
      const dialog = await openPopup();
      const box = within(dialog).getByRole("checkbox");

      expect(box).not.toBeChecked();
      await userEvent.click(box);

      expect(box).toBeChecked();
      await waitFor(() => expect(dialog.textContent?.toLowerCase()).toContain(owner.toLowerCase()));
      const other = ONCHAIN_OWNERS.find((each) => each !== owner)!;
      if (!isAddressEqual(other, OWNER)) expect(dialog.textContent?.toLowerCase()).not.toContain(other.toLowerCase());
    });
  }

  it("is off again when the popup is closed and opened again", async () => {
    chain.owner = ONCHAIN_OWNERS[1];
    await renderPage();

    let dialog = await openPopup();
    await userEvent.click(within(dialog).getByRole("checkbox"));
    expect(within(dialog).getByRole("checkbox")).toBeChecked();
    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    dialog = await openPopup();
    expect(within(dialog).getByRole("checkbox")).not.toBeChecked();
  });
});

describe("MarketPage A11 P&L still shows in the popup and the header after the redeem", () => {
  for (const tick of [false, true]) {
    it(`keeps the session total in the open popup and the header once redeemed, ${tick ? "ticked" : "unticked"}`, async () => {
      chain.owner = ONCHAIN_OWNERS[1];
      const { reread } = await renderPage();
      const dialog = await openPopup();
      if (tick) await userEvent.click(within(dialog).getByRole("checkbox"));
      await waitFor(() => expect(header()).toHaveTextContent(PNL_WORD));
      expect(header()).toHaveTextContent(positive("2.50"));

      // redeemed: both wallets hold nothing left to redeem, and redeem-7's read takes the payouts it indexed
      tradeMock.mockResolvedValue(NOTHING_IN_TRADE_WALLET);
      walletMock.mockResolvedValue(NOTHING_IN_WALLET);
      pnlMock.mockResolvedValue({ ...PNL, options: { ...PNL.options } });
      const readsBefore = pnlMock.mock.calls.length;
      await reread();

      await waitFor(() => expect(pnlMock.mock.calls.length).toBeGreaterThan(readsBefore));
      await waitFor(() => expect(tradeMock.mock.results.length).toBeGreaterThan(1));
      const open = screen.getByRole("dialog");
      expect(open).toHaveTextContent(PNL_WORD);
      expect(open).toHaveTextContent(positive("2.50"));
      expect(header()).toHaveTextContent(PNL_WORD);
      expect(header()).toHaveTextContent(positive("2.50"));
    });
  }
});
