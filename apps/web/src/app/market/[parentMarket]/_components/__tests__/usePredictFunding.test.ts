import { renderHook } from "@testing-library/react";
import type { Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GAS_RESERVE_WEI } from "@/features/predict/oracle/tolerances";

import type { CreditsHeld } from "@/lib/trade-executor/credits";


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
  credits: { data: undefined as CreditsHeld | null | undefined, isLoading: false },
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

vi.mock("../useCreditsHeld", () => ({ useCreditsHeld: () => chain.credits }));

const fund = (args: { amount?: bigint; useCredits?: boolean } = {}) =>
  renderHook(() =>
    usePredictFunding({
      owner: OWNER,
      tradeWallet: TRADE_WALLET,
      collateral: COLLATERAL,
      token: undefined,
      amount: args.amount ?? 0n,
      useCredits: args.useCredits ?? true,
    }),
  ).result.current;

const defaultToken = () => fund().token;

beforeEach(() => {
  chain.sDai = 0n;
  chain.xDai = 0n;
  chain.route = true;
  // 1.25 xDAI per sDAI
  chain.rate = { data: (5n * WAD) / 4n, isError: false };
  chain.credits = { data: undefined, isLoading: false };
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

describe("usePredictFunding, the visitor's credits", () => {
  beforeEach(() => {
    chain.sDai = 10n * WAD;
    chain.route = false;
  });

  it("offers nothing and plans from money alone where the chain has no credits", () => {
    const { credits, funding } = fund({ amount: 3n * WAD });

    expect(credits).toEqual({ state: "none" });
    expect(funding).toMatchObject({ creditsIn: 0n, toAdd: 3n * WAD });
  });

  it("waits for the credits read before planning", () => {
    chain.credits = { data: undefined, isLoading: true };

    expect(fund({ amount: 3n * WAD }).funding).toBeNull();
  });

  it("spends ticked credits first", () => {
    chain.credits = { data: { wallet: 2n * WAD, tradeWallet: 0n, manager: 1000n * WAD }, isLoading: false };
    const { credits, funding } = fund({ amount: 5n * WAD });

    expect(credits).toEqual({ state: "usable", held: 2n * WAD, usable: 2n * WAD });
    expect(funding).toMatchObject({ creditsIn: 2n * WAD, toAdd: 3n * WAD, available: 12n * WAD });
  });

  it("still offers unticked credits but spends none of them", () => {
    chain.credits = { data: { wallet: 2n * WAD, tradeWallet: 0n, manager: 1000n * WAD }, isLoading: false };
    const { credits, funding } = fund({ amount: 5n * WAD, useCredits: false });

    expect(credits.state).toBe("usable");
    expect(funding).toMatchObject({ creditsIn: 0n, creditsAvailable: 0n, toAdd: 5n * WAD, available: 10n * WAD });
  });
});
