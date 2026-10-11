import { describe, expect, it } from "vitest";

import { percentOf, planFunding, shareOf } from "../funding";

const WAD = 10n ** 18n;

describe("planFunding, paying in the collateral", () => {
  it("adds only what the trade wallet is short of", () => {
    expect(planFunding({ amount: 10n * WAD, ownWallet: 20n * WAD, tradeWallet: 6n * WAD })).toEqual({
      available: 26n * WAD,
      collateralIn: 10n * WAD,
      tradeWallet: 6n * WAD,
      fromTradeWallet: 6n * WAD,
      toAdd: 4n * WAD,
      deposit: 4n * WAD,
    });
  });

  it("adds nothing when the trade wallet already holds the amount", () => {
    const funding = planFunding({ amount: 3n * WAD, ownWallet: 20n * WAD, tradeWallet: 6n * WAD });

    expect(funding).toMatchObject({ collateralIn: 3n * WAD, fromTradeWallet: 3n * WAD, toAdd: 0n, deposit: 0n });
  });

  it("takes everything from the visitor's wallet when the trade wallet is empty", () => {
    const funding = planFunding({ amount: 5n * WAD, ownWallet: 20n * WAD, tradeWallet: 0n });

    expect(funding).toMatchObject({ fromTradeWallet: 0n, toAdd: 5n * WAD, deposit: 5n * WAD });
  });
});

describe("planFunding, paying in xDAI", () => {
  // 1.25 xDAI per sDAI
  const rate = (5n * WAD) / 4n;

  it("counts the trade wallet's sDAI at what it redeems for", () => {
    const funding = planFunding({
      amount: 0n,
      ownWallet: 10n * WAD,
      tradeWallet: 4n * WAD,
      tokenPerCollateralWad: rate,
    });

    expect(funding.available).toBe(15n * WAD);
  });

  it("splits the sDAI the amount buys and deposits the xDAI the shortfall costs", () => {
    const funding = planFunding({
      amount: 10n * WAD,
      ownWallet: 20n * WAD,
      tradeWallet: 2n * WAD,
      tokenPerCollateralWad: rate,
    });

    expect(funding).toMatchObject({ collateralIn: 8n * WAD, toAdd: 6n * WAD, deposit: (15n * WAD) / 2n });
  });

  it("rounds the deposit up so what lands covers the shortfall", () => {
    const funding = planFunding({
      amount: 1n,
      ownWallet: 10n,
      tradeWallet: 0n,
      tokenPerCollateralWad: (3n * WAD) / 2n,
    });

    // 1 wei of xDAI buys 0 sDAI wei, so nothing is short
    expect(funding).toMatchObject({ collateralIn: 0n, deposit: 0n });

    const odd = planFunding({ amount: 2n, ownWallet: 10n, tradeWallet: 0n, tokenPerCollateralWad: (3n * WAD) / 2n });
    // 2 wei buys 1 sDAI wei, which costs 1.5 wei, rounded up to 2
    expect(odd).toMatchObject({ collateralIn: 1n, deposit: 2n });
  });

  it("never deposits more than the visitor's wallet holds", () => {
    const funding = planFunding({
      amount: 15n * WAD,
      ownWallet: 10n * WAD,
      tradeWallet: 0n,
      tokenPerCollateralWad: rate,
    });

    expect(funding.deposit).toBe(10n * WAD);
  });
});

describe("the balance slider", () => {
  it("turns a percentage into a share of the balance, rounded down", () => {
    expect(shareOf(999n, 50)).toBe(499n);
    expect(shareOf(10n * WAD, 25)).toBe((5n * WAD) / 2n);
  });

  it("reads an amount back as a whole percentage, capped at 100", () => {
    expect(percentOf(250n, 1000n)).toBe(25);
    expect(percentOf(2000n, 1000n)).toBe(100);
    expect(percentOf(5n, 0n)).toBe(0);
  });
});
