import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePredictRun, type PredictRunInput } from "@/features/predict/hooks/usePredictRun";
import type { SelectedEstimate } from "@/features/predict/types";
import type { Funding } from "@/features/predict/utils/funding";
import type { SessionDetail } from "@/features/sessions/types";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";
import { toSessionDetail, type SessionDetailRow } from "@/features/sessions/utils/toSessionDetail";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { addresses, GATEWAY } from "@/testing/fixtures";

import { usePredictExecution } from "../usePredictExecution";

const OWNER = "0x9999999999999999999999999999999999999999" as Address;
const TRADE_WALLET = "0x8888888888888888888888888888888888888888" as Address;
const WAD = 10n ** 18n;

const chain = vi.hoisted(() => ({
  router: "0x7777777777777777777777777777777777777777",
  factory: "0x6666666666666666666666666666666666666666",
  sDai: "0x5555555555555555555555555555555555555555",
  sDaiAdapter: "0x4444444444444444444444444444444444444444",
}));

// The cache keys import the indexer and RPC clients, which read env this suite does not supply.
vi.mock("@/lib/graphql/batcher", () => ({ fetchGraphql: vi.fn() }));
vi.mock("@/lib/web3/public-client", () => ({ publicClient: {} }));

// The test chain has no Seer router and no sDAI; these stand in for gnosis'.
vi.mock("@/config/contracts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/contracts")>()),
  gnosisRouterAddress: () => chain.router,
  tradeExecutorFactoryAddress: () => chain.factory,
  sDaiDepositRoute: (collateral: Address) =>
    collateral === chain.sDai ? { sDai: chain.sDai, sDaiAdapter: chain.sDaiAdapter } : null,
}));

vi.mock("@/features/predict/hooks/usePredictRun", () => ({ usePredictRun: vi.fn() }));

const runMock = vi.mocked(usePredictRun);

/** Every input the hook handed the run, in render order; null where it was not ready. */
let inputs: (PredictRunInput | null)[] = [];
const lastInput = () => inputs.at(-1) ?? null;

const session = (overrides: Partial<SessionDetailRow> = {}): SessionDetail =>
  toSessionDetail({ ...sessionDetailColumns, ...overrides, children: [sessionChildRow()] }, GATEWAY);

/** Each field a distinct amount, so a getter reading the wrong one cannot match. */
const FUNDING: Funding = {
  available: 11n * WAD,
  collateralIn: 7n * WAD,
  tradeWallet: 5n * WAD,
  fromTradeWallet: 4n * WAD,
  toAdd: 3n * WAD,
  deposit: 2n * WAD,
};

type Args = Parameters<typeof usePredictExecution>[0];

function mount(overrides: Partial<Args> = {}) {
  const detail = overrides.session ?? session();
  const selected: SelectedEstimate[] = [
    { scale: detail.options[0]!, value: 312, marketEstimate: 250, direction: "higher" },
  ];
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const args: Args = {
    session: detail,
    selected,
    owner: OWNER,
    chainId: DEFAULT_CHAIN_ID,
    tradeWallet: TRADE_WALLET,
    funding: FUNDING,
    native: false,
    ...overrides,
  };
  const view = renderHook((props: Args) => usePredictExecution(props), { wrapper, initialProps: args });
  return { ...view, args };
}

beforeEach(() => {
  vi.clearAllMocks();
  inputs = [];
  runMock.mockImplementation((input) => {
    inputs.push(input);
    return { driver: null, progress: null };
  });
});

describe("usePredictExecution, how the visitor pays", () => {
  it("sends an xDAI payment as a native deposit", () => {
    mount({ native: true });

    expect(lastInput()?.depositNative()).toBe(true);
  });

  it("sends a collateral payment as a token deposit", () => {
    mount({ native: false });

    expect(lastInput()?.depositNative()).toBe(false);
  });

  it("hands the run the deposit, the collateral split and the trade wallet's balance from the funding", () => {
    mount();
    const input = lastInput();

    expect({
      deposit: input?.deposit(),
      collateralIn: input?.collateralIn(),
      collateralBefore: input?.collateralBefore(),
    }).toEqual({ deposit: 2n * WAD, collateralIn: 7n * WAD, collateralBefore: 5n * WAD });
  });

  it("hands the run zero for every amount while the funding is unknown", () => {
    mount({ funding: null });
    const input = lastInput();

    expect({
      deposit: input?.deposit(),
      collateralIn: input?.collateralIn(),
      collateralBefore: input?.collateralBefore(),
    }).toEqual({ deposit: 0n, collateralIn: 0n, collateralBefore: 0n });
  });

  it("reads the amounts and the pay token as they stand when the run asks, not when it was built", () => {
    const view = mount({ funding: FUNDING, native: false });
    const built = lastInput();
    const later: Funding = { ...FUNDING, deposit: 9n * WAD, collateralIn: 13n * WAD, tradeWallet: 6n * WAD };

    view.rerender({ ...view.args, funding: later, native: true });

    expect({
      deposit: built?.deposit(),
      depositNative: built?.depositNative(),
      collateralIn: built?.collateralIn(),
      collateralBefore: built?.collateralBefore(),
    }).toEqual({ deposit: 9n * WAD, depositNative: true, collateralIn: 13n * WAD, collateralBefore: 6n * WAD });
  });
});

describe("usePredictExecution, the contracts it names", () => {
  it("names Seer's router and the trade-wallet factory", () => {
    mount();

    expect({ router: lastInput()?.router, factory: lastInput()?.factory }).toEqual({
      router: chain.router,
      factory: chain.factory,
    });
  });

  it("names the savings adapter when the collateral is sDAI", () => {
    mount({ session: session({ collateralToken: chain.sDai }) });

    expect(lastInput()?.sDaiAdapter).toBe(chain.sDaiAdapter);
  });

  it("names no savings adapter when the collateral is not sDAI", () => {
    mount({ session: session({ collateralToken: addresses.collateralToken }) });

    expect(lastInput()?.sDaiAdapter).toBeNull();
  });
});

describe("usePredictExecution, when a run can be built", () => {
  it("is ready for an owner on the app's chain with a trade wallet and a collateral", () => {
    const view = mount();

    expect(view.result.current.ready).toBe(true);
    expect(lastInput()).toMatchObject({ owner: OWNER, executor: TRADE_WALLET });
  });

  it.each([
    { case: "no wallet is connected", overrides: { owner: undefined } },
    { case: "the wallet is on another chain", overrides: { chainId: DEFAULT_CHAIN_ID + 1 } },
    { case: "the wallet's chain is unknown", overrides: { chainId: undefined } },
    { case: "the trade wallet's address is unknown", overrides: { tradeWallet: undefined } },
    { case: "the collateral did not read", overrides: { session: session({ collateralToken: null }) } },
  ] satisfies { case: string; overrides: Partial<Args> }[])("is not ready when $case", ({ overrides }) => {
    const view = mount(overrides);

    expect(view.result.current.ready).toBe(false);
    expect(lastInput()).toBeNull();
  });
});
