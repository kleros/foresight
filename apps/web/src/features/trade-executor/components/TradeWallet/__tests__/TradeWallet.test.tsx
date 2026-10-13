import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseUnits, type Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

/** balanceOf on chain, per token, in the 18 decimals every Seer outcome token carries */
let held: Map<Address, bigint>;

vi.mock("@/lib/web3/public-client", () => ({
  publicClient: {
    getBalance: async () => 0n,
    readContract: async ({ address }: { address: Address }) => held.get(address) ?? 0n,
  },
}));
vi.mock("@/lib/web3/wagmi", () => ({ wagmiConfig: {} }));
vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useAccount: () => ({ address: OWNER, chainId: DEFAULT_CHAIN_ID, chain: DEFAULT_CHAIN }),
}));
vi.mock("../../../api/getExecutor", () => ({
  useExecutor: () => ({ isPending: false, data: { predicted: EXECUTOR, deployed: EXECUTOR } }),
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

const renderWallet = (shown: TradeWalletMarket = market) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TradeWallet market={shown} noun="city" />
    </QueryClientProvider>,
  );

const units = (amount: string) => parseUnits(amount, 18);

/** Each position's side and amount, in the order the option lists them. */
const positionsOf = (option: string) =>
  within(screen.getByRole("list", { name: `${option} positions` }))
    .getAllByRole("listitem")
    .map((item) => item.textContent);

beforeEach(() => {
  held = new Map();
});

describe("TradeWallet positions", () => {
  it("lists the UP and DOWN held on each option", async () => {
    held = new Map([
      [LISBON.up, units("30.43")],
      [LISBON.down, units("1.5")],
      [BERLIN.up, units("2.25")],
      [BERLIN.down, units("30.44")],
    ]);

    renderWallet();

    await waitFor(() => expect(positionsOf("Lisbon")).toEqual(["UP 30.43", "DOWN 1.5"]));
    expect(positionsOf("Berlin")).toEqual(["UP 2.25", "DOWN 30.44"]);
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

    await userEvent.click(screen.getByRole("button", { name: /Advanced options/ }));
    await userEvent.click(await screen.findByRole("option", { name: "Merge" }));

    expect(await screen.findByText("Available: 5 sDAI")).toBeInTheDocument();
  });
});
