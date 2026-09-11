import { describe, expect, it } from "vitest";

import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";
import { toSessionDetail, type SessionDetailRow } from "@/features/sessions/utils/toSessionDetail";

import { addresses, dune, GATEWAY } from "@/testing/fixtures";

import { toWalletMarket } from "../toWalletMarket";

const child = (overrides: Partial<SessionDetailRow["children"][number]> = {}) =>
  sessionChildRow({
    displayName: dune.director.displayName,
    color: dune.director.color,
    underlyingToken: addresses.underlyingToken,
    ...overrides,
  });

const session = (overrides: Partial<SessionDetailRow> = {}) =>
  toSessionDetail(
    {
      ...sessionDetailColumns,
      parentMarket: addresses.parentMarket,
      collateralToken: addresses.collateralToken,
      collateralDecimals: 18,
      collateralSymbol: "sDAI",
      invalidToken: addresses.invalidToken,
      children: [child()],
      ...overrides,
    },
    GATEWAY,
  );

describe("toWalletMarket", () => {
  it("carries the collateral, the parent market and one token per outcome", () => {
    expect(toWalletMarket(session())).toEqual({
      parentMarket: addresses.parentMarket,
      collateral: { address: addresses.collateralToken, decimals: 18, symbol: "sDAI" },
      options: [{ token: addresses.underlyingToken, name: dune.director.displayName, color: dune.director.color }],
      invalidToken: addresses.invalidToken,
    });
  });

  it("refuses a session with no invalid token, which cannot be merged back", () => {
    expect(toWalletMarket(session({ invalidToken: null }))).toBeNull();
  });

  it("refuses a session whose collateral did not read", () => {
    expect(toWalletMarket(session({ collateralToken: null }))).toBeNull();
    expect(toWalletMarket(session({ collateralDecimals: null }))).toBeNull();
    expect(toWalletMarket(session({ collateralSymbol: null }))).toBeNull();
  });

  it("refuses a partial outcome set, since minting one produces tokens for all of them", () => {
    const partial = session({ children: [child(), child({ id: addresses.childMarkets[1], underlyingToken: "" })] });

    expect(toWalletMarket(partial)).toBeNull();
  });

  it("refuses a session whose children are not deployed yet", () => {
    expect(toWalletMarket(session({ children: [] }))).toBeNull();
  });
});
