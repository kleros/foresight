import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseUnits, type Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TradeWalletMismatchError } from "@/lib/trade-executor/executor";

import { DEFAULT_CHAIN, DEFAULT_CHAIN_ID } from "@/config/chains";

import type { TradeWalletMarket } from "../../../types";
import { TradeWallet } from "../TradeWallet";

const OWNER = "0x1111111111111111111111111111111111111111" as Address;
const EXECUTOR = "0x2222222222222222222222222222222222222222" as Address;
const ROUTER = "0x3333333333333333333333333333333333333333" as Address;

const token = (digit: string) => `0x${digit.repeat(40)}` as Address;

const LISBON = { underlying: token("a"), up: token("b"), down: token("c") };
const BERLIN = { underlying: token("d"), up: token("e"), down: token("f") };
const COLLATERAL = token("9");
const INVALID = token("8");

/** The trade wallet's balanceOf on chain, per token, in the 18 decimals every Seer outcome token carries */
let held: Map<Address, bigint>;
/** The owner's own balanceOf, per token */
let ownerHeld: Map<Address, bigint>;
/** What a balanceOf of a position token does instead of answering; undefined answers it */
let positionRead: "pending" | "fail" | undefined;
/** The same for a balanceOf of the collateral, by the owner or the trade wallet */
let fundsRead: "pending" | "fail" | undefined;
let executorRead: { isPending: boolean; data?: { predicted: Address; deployed: Address }; error?: Error };

const balanceOf = (holder: Address) => (holder === EXECUTOR ? held : holder === OWNER ? ownerHeld : new Map());

vi.mock("@/lib/web3/public-client", () => ({
  publicClient: {
    getBalance: async () => 0n,
    readContract: ({ address, args: [holder] }: { address: Address; args: [Address] }) => {
      const isPosition = [LISBON.up, LISBON.down, BERLIN.up, BERLIN.down].includes(address);
      if (isPosition && positionRead === "pending") return new Promise(() => {});
      if (isPosition && positionRead === "fail") return Promise.reject(new Error("balanceOf reverted"));
      if (address === COLLATERAL && fundsRead === "pending") return new Promise(() => {});
      if (address === COLLATERAL && fundsRead === "fail") return Promise.reject(new Error("balanceOf reverted"));
      return Promise.resolve(balanceOf(holder).get(address) ?? 0n);
    },
  },
}));
vi.mock("@/lib/web3/wagmi", () => ({ wagmiConfig: {} }));
vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: OWNER, chainId: DEFAULT_CHAIN_ID, chain: DEFAULT_CHAIN }),
}));
vi.mock("../../../api/getExecutor", () => ({
  useExecutor: () => executorRead,
}));
vi.mock("@/config/contracts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/contracts")>()),
  gnosisRouterAddress: () => ROUTER,
}));

const market: TradeWalletMarket = {
  parentMarket: token("7"),
  collateral: { address: COLLATERAL, decimals: 18, symbol: "sDAI" },
  options: [
    {
      token: LISBON.underlying,
      name: "Lisbon",
      color: "#009aff",
      positions: [
        { side: "UP", token: LISBON.up },
        { side: "DOWN", token: LISBON.down },
      ],
    },
    {
      token: BERLIN.underlying,
      name: "Berlin",
      color: "#ff6a00",
      positions: [
        { side: "UP", token: BERLIN.up },
        { side: "DOWN", token: BERLIN.down },
      ],
    },
  ],
  invalidToken: INVALID,
};

let queryClient: QueryClient;

/** Renders the wallet with its Balances disclosure open, where the option balances live. */
const renderWallet = (shown: TradeWalletMarket = market, { closed = false } = {}) => {
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <TradeWallet market={shown} noun="city" />
    </QueryClientProvider>,
  );
  if (!closed) fireEvent.click(screen.getByRole("button", { name: "Balances" }));
  return rendered;
};

const units = (amount: string) => parseUnits(amount, 18);

/** Each position's side and amount, in the order the option lists them. */
const positionsOf = (option: string) =>
  within(screen.getByRole("list", { name: `${option} positions` }))
    .getAllByRole("listitem")
    .map((item) => item.textContent);

beforeEach(() => {
  held = new Map();
  ownerHeld = new Map();
  positionRead = undefined;
  fundsRead = undefined;
  executorRead = { isPending: false, data: { predicted: EXECUTOR, deployed: EXECUTOR } };
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

describe("TradeWallet's row", () => {
  it("says the network named another trade wallet in place of the row", () => {
    executorRead = { isPending: false, error: new TradeWalletMismatchError() };
    render(
      <QueryClientProvider client={queryClient}>
        <TradeWallet market={market} noun="city" />
      </QueryClientProvider>,
    );

    const wallet = screen.getByRole("region", { name: "Trade wallet" });
    expect(wallet).toHaveTextContent(
      "Your network named a different trade wallet. Switch to another RPC and try again.",
    );
    expect(within(wallet).queryByRole("button")).toBeNull();
  });

  it("is one line of the wallet, its address, its collateral balance, Deposit, Withdraw and Balances", async () => {
    renderWallet(market, { closed: true });
    const wallet = screen.getByRole("region", { name: "Trade wallet" });

    expect(within(wallet).getByText("0x2222...2222")).toBeInTheDocument();
    expect(await within(wallet).findByText("0 sDAI")).toBeInTheDocument();
    for (const name of ["Deposit", "Withdraw", "Balances"]) {
      expect(within(wallet).getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("keeps the option balances and Mint and Merge behind Balances", async () => {
    held = new Map([[LISBON.up, units("3")]]);
    renderWallet(market, { closed: true });
    const balances = screen.getByRole("button", { name: "Balances" });

    expect(balances).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("list", { name: "Lisbon positions" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Mint" })).toBeNull();

    await userEvent.click(balances);

    expect(balances).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => expect(positionsOf("Lisbon")).toEqual(["UP 3", "DOWN 0"]));
    expect(screen.getByRole("button", { name: "Mint" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Merge" })).toBeInTheDocument();
  });
});

describe("a collateral balance that is not read yet, or could not be", () => {
  it("does not show the wallet's row as empty when its balance could not be read", async () => {
    fundsRead = "fail";
    renderWallet(market, { closed: true });
    const wallet = screen.getByRole("region", { name: "Trade wallet" });

    expect(await within(wallet).findByText("Could not read balance")).toBeInTheDocument();
    expect(within(wallet).queryByText("0 sDAI")).toBeNull();
  });

  it.each([
    ["pending", "Reading balance…"],
    ["fail", "Could not read balance"],
  ] as const)("says so in Mint and Deposit when the read is %s", async (read, text) => {
    fundsRead = read;
    renderWallet();

    await userEvent.click(screen.getByRole("button", { name: "Mint" }));
    expect(await within(await screen.findByRole("dialog")).findByText(text)).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await userEvent.click(screen.getByRole("button", { name: "Deposit" }));
    expect(await within(await screen.findByRole("dialog")).findByText(text)).toBeInTheDocument();
  });
});

describe("TradeWallet positions", () => {
  it("lists the UP and DOWN held on each option", async () => {
    held = new Map([
      [LISBON.up, units("30.43")],
      [LISBON.down, units("1.5")],
      [BERLIN.up, units("2.25")],
      [BERLIN.down, units("30.44")],
    ]);
    ownerHeld = new Map([
      [LISBON.up, units("900")],
      [LISBON.down, units("901")],
      [BERLIN.up, units("902")],
      [BERLIN.down, units("903")],
    ]);

    renderWallet();

    await waitFor(() => expect(positionsOf("Lisbon")).toEqual(["UP 30.43", "DOWN 1.5"]));
    expect(positionsOf("Berlin")).toEqual(["UP 2.25", "DOWN 30.44"]);
  });

  it("shows holdings at the position row's 2 decimals, with the full amount in the title", async () => {
    held = new Map([
      [LISBON.underlying, units("160.9234")],
      [LISBON.up, units("214.0912")],
      [LISBON.down, units("1.4387")],
    ]);

    renderWallet();

    await waitFor(() => expect(positionsOf("Lisbon")).toEqual(["UP 214.09", "DOWN 1.43"]));
    expect(screen.getByText("214.09")).toHaveAttribute("title", "214.0912");
    expect(screen.getByText("160.92")).toHaveAttribute("title", "160.9234");
  });

  it("groups large holdings in threes, in the grid and its titles", async () => {
    held = new Map([
      [LISBON.underlying, units("123456789.123")],
      [LISBON.up, units("1234567.891")],
    ]);

    renderWallet();

    await waitFor(() => expect(positionsOf("Lisbon")).toEqual(["UP 1,234,567.89", "DOWN 0"]));
    expect(screen.getByText("123,456,789.12")).toHaveAttribute("title", "123,456,789.123");
  });

  it("shows a dash for each position while its balance is loading", async () => {
    held = new Map([[LISBON.underlying, units("4")]]);
    positionRead = "pending";

    renderWallet();
    await screen.findByTitle("4");

    expect(positionsOf("Lisbon")).toEqual(["UP —", "DOWN —"]);
    expect(positionsOf("Berlin")).toEqual(["UP —", "DOWN —"]);
  });

  it("shows a dash for each position whose balance could not be read", async () => {
    held = new Map([[LISBON.underlying, units("4")]]);
    positionRead = "fail";

    renderWallet();
    await screen.findByTitle("4");
    await waitFor(() =>
      expect(
        queryClient
          .getQueryCache()
          .getAll()
          .some((query) => query.state.status === "error"),
      ).toBe(true),
    );

    expect(positionsOf("Lisbon")).toEqual(["UP —", "DOWN —"]);
    expect(positionsOf("Berlin")).toEqual(["UP —", "DOWN —"]);
  });

  it("shows the underlying balance of each option, and not INVALID's", async () => {
    held = new Map([
      [LISBON.underlying, units("4")],
      [BERLIN.underlying, units("7")],
      [INVALID, units("3")],
      [LISBON.up, units("11")],
    ]);

    renderWallet();

    expect(await screen.findByText("4")).toHaveAttribute("title", "4");
    expect(screen.getByText("7")).toHaveAttribute("title", "7");
    expect(screen.queryByTitle("3")).not.toBeInTheDocument();
  });

  it("lists no positions for an option whose UP and DOWN tokens are unknown", async () => {
    renderWallet({ ...market, options: market.options.map((option) => ({ ...option, positions: [] })) });

    expect(await screen.findByText("Lisbon")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Lisbon positions" })).not.toBeInTheDocument();
  });

  it("bounds a merge by the smallest of the underlying set and INVALID, whatever UP and DOWN are held", async () => {
    held = new Map([
      [LISBON.underlying, units("5")],
      [BERLIN.underlying, units("9")],
      [INVALID, units("6")],
      [LISBON.up, units("1")],
      [BERLIN.down, units("2")],
    ]);
    renderWallet();
    await screen.findByTitle("5");

    await userEvent.click(screen.getByRole("button", { name: "Merge" }));

    expect(await screen.findByText("Full sets: 5")).toBeInTheDocument();
  });

  it("explains UP and DOWN once, beside the tokens heading, not once per option", async () => {
    renderWallet();
    const panel = document.getElementById(
      screen.getByRole("button", { name: "Balances" }).getAttribute("aria-controls") ?? "",
    );

    expect(within(panel!).getAllByRole("button", { name: "About UP and DOWN" })).toHaveLength(1);
    expect(within(panel!).queryAllByRole("button", { name: "" })).toHaveLength(0);
  });
});

describe("TradeWallet's amount dialogs", () => {
  it("shows a merge's balance at four decimals and names the cap when the amount is over it", async () => {
    held = new Map([
      [LISBON.underlying, units("5.123456789")],
      [BERLIN.underlying, units("9")],
      [INVALID, units("6")],
    ]);
    renderWallet();
    await screen.findByTitle(/^5\.1234/);

    await userEvent.click(screen.getByRole("button", { name: "Merge" }));
    const dialog = await screen.findByRole("dialog");

    expect(await within(dialog).findByText("Full sets: 5.1234")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole("spinbutton"), "6");
    expect(await within(dialog).findByText("Not enough sets. Max 5.1234.")).toBeInTheDocument();
  });

  it("opens Mint's amount without marking it invalid before anything is typed", async () => {
    renderWallet();

    await userEvent.click(screen.getByRole("button", { name: "Mint" }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByRole("spinbutton")).not.toBeRequired();
    expect(within(dialog).getByRole("spinbutton")).toBeValid();
  });

  it("words Mint's hint with the market's own collateral", async () => {
    renderWallet({ ...market, collateral: { ...market.collateral, symbol: "wstETH" } });

    await userEvent.click(screen.getByRole("button", { name: "Mint" }));

    expect(await screen.findByText("Turns wstETH in your trade wallet into city tokens.")).toBeInTheDocument();
  });

  it("names a balance under the last shown decimal rather than showing it as 0", async () => {
    ownerHeld = new Map([[COLLATERAL, units("0.00001")]]);
    renderWallet(market, { closed: true });

    await userEvent.click(screen.getByRole("button", { name: "Deposit" }));
    const dialog = await screen.findByRole("dialog");

    expect(await within(dialog).findByText("Balance: less than 0.0001 sDAI")).toBeInTheDocument();
  });

  it.each(["Deposit", "Withdraw"])("names %s's amount field for a screen reader", async (action) => {
    ownerHeld = new Map([[COLLATERAL, units("1")]]);
    renderWallet(market, { closed: true });

    await userEvent.click(screen.getByRole("button", { name: action }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByRole("spinbutton")).toHaveAccessibleName("Amount");
  });

  it("does not offer a Max of 0 over an empty balance", async () => {
    renderWallet(market, { closed: true });

    await userEvent.click(screen.getByRole("button", { name: "Deposit" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Balance: 0 sDAI");
    await userEvent.type(within(dialog).getByRole("spinbutton"), "1");

    expect(await within(dialog).findByText("Not enough balance.")).toBeInTheDocument();
  });

  it("groups a large balance and its cap in threes, and Max fills the shown amount ungrouped", async () => {
    ownerHeld = new Map([[COLLATERAL, units("98765432109.12345")]]);
    renderWallet(market, { closed: true });

    await userEvent.click(screen.getByRole("button", { name: "Deposit" }));
    const dialog = await screen.findByRole("dialog");

    expect(await within(dialog).findByText("Balance: 98,765,432,109.1234 sDAI")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Max" }));
    expect(within(dialog).getByRole("spinbutton")).toHaveValue("98765432109.1234");
  });

  it("names no Max when a deposit is over a balance under the last shown decimal", async () => {
    ownerHeld = new Map([[COLLATERAL, units("0.00001")]]);
    renderWallet(market, { closed: true });

    await userEvent.click(screen.getByRole("button", { name: "Deposit" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Balance: less than 0.0001 sDAI");
    await userEvent.type(within(dialog).getByRole("spinbutton"), "1");

    expect(await within(dialog).findByText("Not enough balance.")).toBeInTheDocument();
  });

  it("names no Max when a mint is over a balance under the last shown decimal", async () => {
    held = new Map([[COLLATERAL, units("0.00001")]]);
    renderWallet();

    await userEvent.click(screen.getByRole("button", { name: "Mint" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Balance: less than 0.0001 sDAI");
    await userEvent.type(within(dialog).getByRole("spinbutton"), "1");

    expect(await within(dialog).findByText("Not enough balance.")).toBeInTheDocument();
  });

  it("shows a deposit's balance at four decimals with its token, and names the cap when the amount is over it", async () => {
    ownerHeld = new Map([[COLLATERAL, units("2.56789")]]);
    renderWallet(market, { closed: true });

    await userEvent.click(screen.getByRole("button", { name: "Deposit" }));
    const dialog = await screen.findByRole("dialog");

    expect(await within(dialog).findByText("Balance: 2.5678 sDAI")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole("spinbutton"), "3");
    expect(await within(dialog).findByText("Not enough balance. Max 2.5678 sDAI.")).toBeInTheDocument();
  });
});
