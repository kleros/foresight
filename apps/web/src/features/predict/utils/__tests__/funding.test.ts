import { describe, expect, it } from "vitest";

import { AMOUNT_DISPLAY_DECIMALS, GAS_RESERVE_WEI } from "../../oracle/tolerances";
import { percentOf, planFunding, roundToDisplay, shareOf } from "../funding";

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

  it("counts the trade wallet's sDAI at what it redeems for, and the wallet less the gas reserve", () => {
    const funding = planFunding({
      amount: 0n,
      ownWallet: 10n * WAD,
      tradeWallet: 4n * WAD,
      tokenPerCollateralWad: rate,
    });

    expect(funding.available).toBe(15n * WAD - GAS_RESERVE_WEI);
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
      ownWallet: 10n * WAD,
      tradeWallet: 0n,
      tokenPerCollateralWad: (3n * WAD) / 2n,
    });

    // 1 wei of xDAI buys 0 sDAI wei, so nothing is short
    expect(funding).toMatchObject({ collateralIn: 0n, deposit: 0n });

    const odd = planFunding({
      amount: 2n,
      ownWallet: 10n * WAD,
      tradeWallet: 0n,
      tokenPerCollateralWad: (3n * WAD) / 2n,
    });
    // 2 wei buys 1 sDAI wei, which costs 1.5 wei, rounded up to 2
    expect(odd).toMatchObject({ collateralIn: 1n, deposit: 2n });
  });

  it("never deposits more than the visitor's wallet holds less the gas reserve", () => {
    const funding = planFunding({
      amount: 15n * WAD,
      ownWallet: 10n * WAD,
      tradeWallet: 0n,
      tokenPerCollateralWad: rate,
    });

    expect(funding.deposit).toBe(10n * WAD - GAS_RESERVE_WEI);
  });
});

describe("planFunding, the xDAI gas reserve", () => {
  // 1.25 xDAI per sDAI
  const rate = (5n * WAD) / 4n;
  const own = 10n * WAD;
  const spendable = own - GAS_RESERVE_WEI;
  const STEP = 10n ** BigInt(18 - AMOUNT_DISPLAY_DECIMALS);

  it("Max leaves the reserve: available and the deposit stop short of the native balance by it", () => {
    const { available } = planFunding({ amount: 0n, ownWallet: own, tradeWallet: 0n, tokenPerCollateralWad: rate });
    expect(available).toBe(spendable);

    const max = planFunding({ amount: available, ownWallet: own, tradeWallet: 0n, tokenPerCollateralWad: rate });
    expect(max.available).toBe(spendable);
    expect(max.deposit).toBeLessThanOrEqual(spendable);
    expect(own - max.deposit).toBeGreaterThanOrEqual(GAS_RESERVE_WEI);
    expect(max.deposit).toBeGreaterThan(spendable - 2n);
  });

  it.each([
    ["just inside the reserve", own - GAS_RESERVE_WEI / 2n],
    ["the whole balance", own],
    ["past the balance", own + GAS_RESERVE_WEI],
    ["twice the balance", 2n * own],
  ])("an amount above the reserve, %s, deposits no more than the balance less the reserve", (_, amount) => {
    const funding = planFunding({ amount, ownWallet: own, tradeWallet: 0n, tokenPerCollateralWad: rate });

    expect(funding.available).toBe(spendable);
    expect(funding.deposit).toBe(spendable);
  });

  it("Max with sDAI already in the trade wallet keeps the reserve too", () => {
    const tradeWallet = 2n * WAD;
    const { available } = planFunding({ amount: 0n, ownWallet: own, tradeWallet, tokenPerCollateralWad: rate });
    expect(available).toBe(spendable + (tradeWallet * rate) / WAD);

    const funding = planFunding({ amount: available, ownWallet: own, tradeWallet, tokenPerCollateralWad: rate });
    expect(funding.fromTradeWallet).toBe(tradeWallet);
    expect(funding.deposit).toBeLessThanOrEqual(spendable);
  });

  it("deposits what an amount well inside the balance costs, unchanged by the reserve", () => {
    const funding = planFunding({ amount: 5n * WAD, ownWallet: own, tradeWallet: 0n, tokenPerCollateralWad: rate });

    expect(funding).toMatchObject({ available: spendable, collateralIn: 4n * WAD, deposit: 5n * WAD });
  });

  it.each([0n, 1n, GAS_RESERVE_WEI / 2n, GAS_RESERVE_WEI])(
    "offers and deposits nothing from a wallet holding %s wei, no more than the reserve",
    (ownWallet) => {
      const funding = planFunding({ amount: WAD, ownWallet, tradeWallet: 0n, tokenPerCollateralWad: rate });

      expect(funding.available).toBe(0n);
      expect(funding.deposit).toBe(0n);
    },
  );

  it("keeps no reserve on sDAI, which is not the gas token", () => {
    const funding = planFunding({ amount: own, ownWallet: own, tradeWallet: 0n });

    expect(funding).toMatchObject({ available: own, deposit: own });
  });

  it("over generated balances and amounts, never touches the reserve and still covers what it can", () => {
    // xorshift64 with a fixed seed, so a failure reproduces
    let state = 0x9e3779b97f4a7c15n;
    const next = (bound: bigint) => {
      state ^= (state << 13n) & 0xffffffffffffffffn;
      state ^= state >> 7n;
      state ^= (state << 17n) & 0xffffffffffffffffn;
      return ((state * 0x2545f4914f6cdd1dn) & ((1n << 96n) - 1n)) % bound;
    };

    for (let run = 0; run < 500; run++) {
      const ownWallet = next(100n * WAD);
      const tradeWallet = next(50n * WAD);
      const tokenPerCollateralWad = WAD + next(WAD / 2n);
      const amount = next(200n * WAD);
      const funding = planFunding({ amount, ownWallet, tradeWallet, tokenPerCollateralWad });
      const canSpend = ownWallet > GAS_RESERVE_WEI ? ownWallet - GAS_RESERVE_WEI : 0n;
      const ceiling = canSpend + (tradeWallet * tokenPerCollateralWad) / WAD;
      const seen = JSON.stringify({ run, ownWallet, tradeWallet, tokenPerCollateralWad, amount }, (_, v) =>
        typeof v === "bigint" ? `${v}` : v,
      );

      expect(funding.available, seen).toBeLessThanOrEqual(ceiling);
      expect(ceiling - funding.available, seen).toBeLessThan(STEP);
      expect(funding.deposit, seen).toBeLessThanOrEqual(canSpend);
      if (amount <= funding.available && funding.deposit < canSpend) {
        // what the deposit mints covers the shortfall
        expect((funding.deposit * WAD) / tokenPerCollateralWad + 1n, seen).toBeGreaterThanOrEqual(funding.toAdd);
      }
    }
  });
});

describe("planFunding, the decided 0.01 xDAI reserve", () => {
  // 1.25 xDAI per sDAI
  const rate = (5n * WAD) / 4n;

  it("Max on a 10 xDAI wallet offers 9.99 xDAI", () => {
    const funding = planFunding({ amount: 0n, ownWallet: 10n * WAD, tradeWallet: 0n, tokenPerCollateralWad: rate });

    expect(funding.available).toBe(9_990_000_000_000_000_000n);
  });

  it("an amount of the whole 10 xDAI deposits 9.99 xDAI", () => {
    const funding = planFunding({
      amount: 10n * WAD,
      ownWallet: 10n * WAD,
      tradeWallet: 0n,
      tokenPerCollateralWad: rate,
    });

    expect(funding.deposit).toBe(9_990_000_000_000_000_000n);
  });
});

describe("rounding an amount to the 4 decimals the popup shows", () => {
  it("cuts an 18-decimal amount down to 4 decimals", () => {
    expect(roundToDisplay(1_234_567_890_123_456_789n, 18)).toBe(1_234_500_000_000_000_000n);
  });

  it("cuts a 6-decimal amount down to 4 decimals", () => {
    expect(roundToDisplay(1_234_567n, 6)).toBe(1_234_500n);
  });

  it("leaves an amount with no more than 4 decimals as it is", () => {
    expect(roundToDisplay(1_234_500_000_000_000_000n, 18)).toBe(1_234_500_000_000_000_000n);
    expect(roundToDisplay(123n, 2)).toBe(123n);
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
