import { renderHook } from "@testing-library/react";
import type { Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionDetail } from "@/features/sessions/types";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { useOptionPositions } from "../useOptionPositions";

const OWNER = "0x0000000000000000000000000000000000000a11" as Address;
const TRADE_WALLET = "0x00000000000000000000000000000000000e7ec0" as Address;
const WAD = 10n ** 18n;

const account = vi.hoisted(() => ({ address: undefined as Address | undefined, chainId: undefined as number | undefined }));
const executor = vi.hoisted(() => ({ deployed: undefined as Address | undefined | null }));
const balances = vi.hoisted(() => ({
  data: undefined as bigint[] | undefined,
  calls: [] as Array<{ holder: Address | undefined; tokens: Address[] }>,
}));

vi.mock("wagmi", () => ({ useAccount: () => account }));
vi.mock("@/features/trade-executor/api/getExecutor", () => ({
  useExecutor: () => ({ data: executor.deployed === undefined ? undefined : { deployed: executor.deployed } }),
}));
vi.mock("@/features/trade-executor/api/getTokenBalances", () => ({
  useTokenBalances: (holder: Address | undefined, tokens: Address[]) => {
    balances.calls.push({ holder, tokens });
    return { data: holder ? balances.data : undefined };
  },
}));

const token = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
const option = (market: string, upToken: Address | null, downToken: Address | null) => ({
  market,
  upToken,
  downToken,
});

/** A, then B with no tokens yet, then C: B must not shift C's balances. */
const session = {
  collateralDecimals: 18,
  options: [
    option("0xAAAA000000000000000000000000000000000000", token(1), token(2)),
    option("0xBBBB000000000000000000000000000000000000", null, null),
    option("0xCCCC000000000000000000000000000000000000", token(3), token(4)),
  ],
} as unknown as SessionDetail;

beforeEach(() => {
  account.address = OWNER;
  account.chainId = DEFAULT_CHAIN_ID;
  executor.deployed = TRADE_WALLET;
  balances.data = undefined;
  balances.calls = [];
});

describe("useOptionPositions", () => {
  it("reads the trade wallet, not the connected account", () => {
    renderHook(() => useOptionPositions(session));

    expect(balances.calls.at(-1)?.holder).toBe(TRADE_WALLET);
  });

  it("asks for each traded option's UP then DOWN, skipping an option with no tokens", () => {
    renderHook(() => useOptionPositions(session));

    expect(balances.calls.at(-1)?.tokens).toEqual([token(1), token(2), token(3), token(4)]);
  });

  it("keys each option's UP and DOWN by its lower-case market", () => {
    balances.data = [3n * WAD, 1n * WAD, 0n, 7n * WAD];

    const { result } = renderHook(() => useOptionPositions(session));

    expect(result.current).toEqual({
      "0xaaaa000000000000000000000000000000000000": { up: 3n * WAD, down: 1n * WAD },
      "0xcccc000000000000000000000000000000000000": { up: 0n, down: 7n * WAD },
    });
  });

  it("shows nothing while the wallet is on another chain", () => {
    account.chainId = DEFAULT_CHAIN_ID + 1;
    balances.data = [3n * WAD, 1n * WAD, 0n, 7n * WAD];

    const { result } = renderHook(() => useOptionPositions(session));

    expect(balances.calls.at(-1)?.holder).toBeUndefined();
    expect(result.current).toEqual({});
  });

  it("shows nothing before the trade wallet is deployed", () => {
    executor.deployed = null;
    balances.data = [3n * WAD, 1n * WAD, 0n, 7n * WAD];

    const { result } = renderHook(() => useOptionPositions(session));

    expect(result.current).toEqual({});
  });

  it("counts a holding too small to show at two decimals as none", () => {
    // 0.004 UP and 0.004 DOWN read as 0 UP · 0 DOWN
    balances.data = [4n * 10n ** 15n, 4n * 10n ** 15n, 0n, 1n * 10n ** 16n];

    const { result } = renderHook(() => useOptionPositions(session));

    expect(result.current).toEqual({
      "0xcccc000000000000000000000000000000000000": { up: 0n, down: 1n * 10n ** 16n },
    });
  });
});
