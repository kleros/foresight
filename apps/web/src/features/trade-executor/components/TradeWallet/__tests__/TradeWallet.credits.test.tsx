import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
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
const COLLATERAL = token("9");
const INVALID = token("8");

/** balanceOf on chain per holder and token */
let held: Map<Address, Map<Address, bigint>>;
/** Tokens whose balanceOf the node refuses to answer. */
let unreadable: Set<Address>;
/** balanceOf calls, per token. */
let reads: Map<Address, number>;

vi.mock("@/lib/web3/public-client", () => ({
  publicClient: {
    getBalance: async () => 0n,
    readContract: ({ address, args: [holder] }: { address: Address; args: [Address] }) => {
      reads.set(address, (reads.get(address) ?? 0) + 1);
      if (unreadable.has(address)) return Promise.reject(new Error("HTTP request failed. Status: 429"));
      return Promise.resolve(held.get(holder)?.get(address) ?? 0n);
    },
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
const CREDITS = token("5");
const WXDAI = token("4");
vi.mock("@/config/contracts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/contracts")>()),
  gnosisRouterAddress: () => ROUTER,
  creditsContracts: () => ({ credits: CREDITS, manager: token("6") }),
  creditsRoute: () => ({ token: CREDITS, manager: token("6"), wxdai: WXDAI, swaprRouter: token("3") }),
}));

/** What each action was asked to sign, as its mutation received it. */
const { sent, mutation } = vi.hoisted(() => ({
  sent: { deposit: [] as unknown[], withdraw: [] as unknown[], mint: [] as unknown[], merge: [] as unknown[] },
  mutation: (log: unknown[]) => () => ({ mutate: (input: unknown) => log.push(input), isPending: false }),
}));
vi.mock("../../../api/depositToExecutor", () => ({ useDepositToExecutor: mutation(sent.deposit) }));
vi.mock("../../../api/withdrawFromExecutor", () => ({ useWithdrawFromExecutor: mutation(sent.withdraw) }));
vi.mock("../../../api/splitFromExecutor", () => ({ useSplitFromExecutor: mutation(sent.mint) }));
vi.mock("../../../api/mergeFromExecutor", () => ({ useMergeFromExecutor: mutation(sent.merge) }));

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
  ],
  invalidToken: INVALID,
};

const units = (amount: string) => parseUnits(amount, 18);

function renderWallet() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TradeWallet market={market} noun="city" />
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  held = new Map();
  unreadable = new Set();
  reads = new Map();
  for (const log of Object.values(sent)) log.length = 0;
});

describe("a held token's balance in Withdraw", () => {
  it("offers the WXDAI it could read when the credits read fails, and says the credits could not be read", async () => {
    held.set(EXECUTOR, new Map([[WXDAI, units("3")]]));
    unreadable.add(CREDITS);
    renderWallet();

    await userEvent.click(await screen.findByRole("button", { name: "Withdraw" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /sDAI/ }));
    expect(await screen.findByRole("option", { name: "WXDAI" })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("option", { name: "credits" }));

    expect(await within(dialog).findByText("Could not read balance")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Withdraw" })).toBeDisabled();
  });

  it("reads the held tokens again as Withdraw opens, so a balance that changed elsewhere is not offered", async () => {
    held.set(EXECUTOR, new Map([[CREDITS, units("3")]]));
    renderWallet();
    await userEvent.click(await screen.findByRole("button", { name: "Withdraw" }));
    await screen.findByRole("dialog");
    await userEvent.keyboard("{Escape}");
    const before = reads.get(CREDITS) ?? 0;

    // another tab withdraws the credits, and the balances are past their stale time
    held.get(EXECUTOR)!.set(CREDITS, 0n);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 60_000);
    try {
      await userEvent.click(await screen.findByRole("button", { name: "Withdraw" }));
      const dialog = await screen.findByRole("dialog");
      await vi.waitFor(() => expect(reads.get(CREDITS)).toBeGreaterThan(before));
      await userEvent.click(within(dialog).getByRole("button", { name: /sDAI/ }));

      expect(screen.queryByRole("option", { name: "credits" })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("credits in the trade wallet's Withdraw", () => {
  it("offers the trade wallet's credits and withdraws all of them to the owner", async () => {
    held.set(EXECUTOR, new Map([[CREDITS, units("3.123456789")]]));
    renderWallet();

    await userEvent.click(await screen.findByRole("button", { name: "Withdraw" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /sDAI/ }));
    await userEvent.click(await screen.findByRole("option", { name: "credits" }));
    await within(dialog).findByText("Balance: 3.1234 credits");
    await userEvent.click(within(dialog).getByRole("button", { name: "Max" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Withdraw" }));

    expect(sent.withdraw).toEqual([
      { executor: EXECUTOR, recipient: OWNER, assets: [{ token: CREDITS, amount: units("3.123456789") }] },
    ]);
  });

  it("signs nothing when the picked credits re-read as zero while the dialog is open", async () => {
    held.set(
      EXECUTOR,
      new Map([
        [CREDITS, units("3")],
        [COLLATERAL, units("10")],
      ]),
    );
    const client = renderWallet();

    await userEvent.click(await screen.findByRole("button", { name: "Withdraw" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /sDAI/ }));
    await userEvent.click(await screen.findByRole("option", { name: "credits" }));
    await within(dialog).findByText("Balance: 3 credits");
    await userEvent.type(within(dialog).getByRole("spinbutton"), "2");

    held.get(EXECUTOR)!.set(CREDITS, 0n);
    await client.invalidateQueries();
    // the pick stays credits, at the zero balance it re-read as, until another token is picked
    await within(dialog).findByText("Not enough balance.");
    expect(within(dialog).getByRole("button", { name: /credits/ })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Withdraw" }));

    expect(sent.withdraw).toEqual([]);
  });

  it("offers no credits when the trade wallet holds none", async () => {
    renderWallet();

    await userEvent.click(await screen.findByRole("button", { name: "Withdraw" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /sDAI/ }));

    expect(await screen.findAllByRole("option")).not.toHaveLength(0);
    expect(screen.queryByRole("option", { name: "credits" })).toBeNull();
  });

  it("never offers credits to deposit", async () => {
    held.set(OWNER, new Map([[CREDITS, units("3")]]));
    held.set(EXECUTOR, new Map([[CREDITS, units("3")]]));
    renderWallet();

    await userEvent.click(await screen.findByRole("button", { name: "Deposit" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /sDAI/ }));

    expect(screen.queryByRole("option", { name: "credits" })).toBeNull();
  });
});

describe("the credits swap's WXDAI in the trade wallet's Withdraw", () => {
  it("offers the WXDAI left in the trade wallet and withdraws all of it to the owner", async () => {
    held.set(EXECUTOR, new Map([[WXDAI, units("0.075212450551323781")]]));
    renderWallet();

    await userEvent.click(await screen.findByRole("button", { name: "Withdraw" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /sDAI/ }));
    await userEvent.click(await screen.findByRole("option", { name: "WXDAI" }));
    await within(dialog).findByText("Balance: 0.0752 WXDAI");
    await userEvent.click(within(dialog).getByRole("button", { name: "Max" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Withdraw" }));

    expect(sent.withdraw).toEqual([
      { executor: EXECUTOR, recipient: OWNER, assets: [{ token: WXDAI, amount: units("0.075212450551323781") }] },
    ]);
  });

  it("offers no WXDAI when the trade wallet holds none", async () => {
    renderWallet();

    await userEvent.click(await screen.findByRole("button", { name: "Withdraw" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /sDAI/ }));

    expect(await screen.findAllByRole("option")).not.toHaveLength(0);
    expect(screen.queryByRole("option", { name: "WXDAI" })).toBeNull();
  });
});
