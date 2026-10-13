import { renderHook } from "@testing-library/react";
import type { Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GAS_RESERVE_WEI } from "@/features/predict/oracle/tolerances";

import { usePredictFunding } from "../usePredictFunding";

const OWNER = "0x9999999999999999999999999999999999999999" as Address;
const TRADE_WALLET = "0x8888888888888888888888888888888888888888" as Address;
const COLLATERAL = "0x3333333333333333333333333333333333333333" as Address;
const WAD = 10n ** 18n;

const chain = vi.hoisted(() => ({
  sDai: 0n,
  xDai: 0n,
  route: true,
  rate: { data: undefined as bigint | undefined, isError: false },
}));

vi.mock("@/config/contracts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/contracts")>()),
  sDaiDepositRoute: (collateral: Address) =>
    chain.route ? { sDai: collateral, sDaiAdapter: "0x4444444444444444444444444444444444444444" } : null,
}));

vi.mock("@/features/trade-executor/api/getFunds", () => ({
  useFunds: (holder: Address | undefined) => ({
    data: holder === OWNER ? { native: chain.xDai, token: chain.sDai } : { native: 0n, token: 0n },
    isPending: false,
  }),
}));

vi.mock("@/features/predict/api/getSavingsRate", () => ({
  useSavingsRate: (sDai: Address | undefined) =>
    sDai ? { ...chain.rate, isPending: chain.rate.data === undefined && !chain.rate.isError } : { isPending: true },
}));

const defaultToken = () =>
  renderHook(() =>
    usePredictFunding({
      owner: OWNER,
      tradeWallet: TRADE_WALLET,
      collateral: COLLATERAL,
      token: undefined,
      amount: 0n,
    }),
  ).result.current.token;

beforeEach(() => {
  chain.sDai = 0n;
  chain.xDai = 0n;
  chain.route = true;
  // 1.25 xDAI per sDAI
  chain.rate = { data: (5n * WAD) / 4n, isError: false };
});

describe("usePredictFunding, the default pay token", () => {
  it("compares by collateral value, not by the nominal numbers", () => {
    // 11 spendable xDAI is 8.8 sDAI, less than the 10 sDAI held
    chain.sDai = 10n * WAD;
    chain.xDai = 11n * WAD + GAS_RESERVE_WEI;

    expect(defaultToken()).toBe("collateral");
  });

  it("waits for the rate before choosing", () => {
    chain.xDai = 50n * WAD;
    chain.rate = { data: undefined, isError: false };

    expect(defaultToken()).toBeUndefined();
  });

  it("falls back to the collateral when the rate cannot be read", () => {
    chain.xDai = 50n * WAD;
    chain.rate = { data: undefined, isError: true };

    expect(defaultToken()).toBe("collateral");
  });

  it("is the collateral when xDAI cannot pay for this session", () => {
    chain.xDai = 50n * WAD;
    chain.route = false;

    expect(defaultToken()).toBe("collateral");
  });
});
