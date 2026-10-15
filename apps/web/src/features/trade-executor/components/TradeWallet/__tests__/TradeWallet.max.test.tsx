import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
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

vi.mock("@/lib/web3/public-client", () => ({
  publicClient: {
    getBalance: async () => 0n,
    readContract: ({ address, args: [holder] }: { address: Address; args: [Address] }) =>
      Promise.resolve(held.get(holder)?.get(address) ?? 0n),
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

async function pressMax(action: "Deposit" | "Withdraw" | "Mint" | "Merge", balanceText: string) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TradeWallet market={market} noun="city" />
    </QueryClientProvider>,
  );
  if (action === "Mint" || action === "Merge") fireEvent.click(screen.getByRole("button", { name: "Balances" }));
  await userEvent.click(await screen.findByRole("button", { name: action }));
  const dialog = await screen.findByRole("dialog");
  await within(dialog).findByText(balanceText);
  await userEvent.click(within(dialog).getByRole("button", { name: "Max" }));
  await userEvent.click(within(dialog).getByRole("button", { name: action }));
}

beforeEach(() => {
  held = new Map();
  for (const log of Object.values(sent)) log.length = 0;
});

describe("Max in the trade wallet's dialogs", () => {
  it("deposits the balance as shown, cut to its four decimals", async () => {
    held.set(OWNER, new Map([[COLLATERAL, units("1234.56789")]]));

    await pressMax("Deposit", "Balance: 1,234.5678 sDAI");

    expect(sent.deposit).toEqual([
      expect.objectContaining({ asset: { token: COLLATERAL, amount: units("1234.5678") } }),
    ]);
  });

  it("mints the balance as shown, cut to its four decimals", async () => {
    held.set(EXECUTOR, new Map([[COLLATERAL, units("2.56789")]]));

    await pressMax("Mint", "Balance: 2.5678 sDAI");

    expect(sent.mint).toEqual([expect.objectContaining({ amount: units("2.5678") })]);
  });

  it("merges the full sets as shown, cut to their four decimals", async () => {
    held.set(
      EXECUTOR,
      new Map([
        [LISBON.underlying, units("5.123456789")],
        [INVALID, units("6")],
      ]),
    );

    await pressMax("Merge", "Full sets: 5.1234");

    expect(sent.merge).toEqual([expect.objectContaining({ amount: units("5.1234") })]);
  });

  it("withdraws the whole balance, past the decimals shown", async () => {
    held.set(EXECUTOR, new Map([[COLLATERAL, units("2.56789")]]));

    await pressMax("Withdraw", "Balance: 2.5678 sDAI");

    expect(sent.withdraw).toEqual([
      expect.objectContaining({ assets: [{ token: COLLATERAL, amount: units("2.56789") }] }),
    ]);
  });

  it("offers no Max for a deposit under the last shown decimal, which would cut to 0", async () => {
    held.set(OWNER, new Map([[COLLATERAL, units("0.00001")]]));
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <TradeWallet market={market} noun="city" />
      </QueryClientProvider>,
    );

    await userEvent.click(await screen.findByRole("button", { name: "Deposit" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Balance: less than 0.0001 sDAI");

    expect(within(dialog).getByRole("button", { name: "Max" })).toBeDisabled();
  });
});
