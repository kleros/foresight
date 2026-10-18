import { describe, expect, it } from "vitest";

import { creditLines, creditsOffer, MIN_CREDITS, type CreditsHeld } from "../credits";
import { fundingSummary, planFunding } from "../funding";

const WAD = 10n ** 18n;
const sDai = { id: "collateral" as const, symbol: "sDAI", decimals: 18 };
const xDai = { id: "native" as const, symbol: "xDAI", decimals: 18 };
const collateral = { symbol: "sDAI", decimals: 18 };

/** Funding for `amount` sDAI with the credits ticked, as the popup plans it. */
function fund(held: CreditsHeld, amount: bigint, money = { ownWallet: 0n, tradeWallet: 0n }) {
  const offer = creditsOffer(held);
  const funding = planFunding({ amount, ...money, credits: creditLines(held, offer) });
  return { offer, funding, summary: fundingSummary({ funding, amount, token: sDai, collateral })?.text };
}

describe("creditsOffer", () => {
  it("offers nothing to a visitor with no credits, or 0.01 and below", () => {
    expect(creditsOffer(null)).toEqual({ state: "none" });
    expect(creditsOffer({ wallet: 0n, tradeWallet: 0n, manager: 1000n * WAD })).toEqual({ state: "none" });
    expect(creditsOffer({ wallet: MIN_CREDITS / 2n, tradeWallet: MIN_CREDITS / 2n, manager: 1000n * WAD })).toEqual({
      state: "none",
    });
    expect(creditsOffer({ wallet: WAD / 200n, tradeWallet: 0n, manager: 1000n * WAD }).state).toBe("none");
  });

  it("sums the wallet's and the trade wallet's credits, all usable when the manager covers them", () => {
    expect(creditsOffer({ wallet: 3n * WAD, tradeWallet: 2n * WAD, manager: 1000n * WAD })).toEqual({
      state: "usable",
      held: 5n * WAD,
      usable: 5n * WAD,
    });
  });

  it("caps what is usable at the manager's collateral when it is short", () => {
    expect(creditsOffer({ wallet: 500n * WAD, tradeWallet: 0n, manager: 200n * WAD })).toEqual({
      state: "short",
      held: 500n * WAD,
      usable: 200n * WAD,
    });
  });

  it("offers none as usable when the manager is empty, or holds 0.01 and below", () => {
    expect(creditsOffer({ wallet: 5n * WAD, tradeWallet: 0n, manager: 0n })).toEqual({
      state: "empty",
      held: 5n * WAD,
      usable: 0n,
    });
    expect(creditsOffer({ wallet: 5n * WAD, tradeWallet: 0n, manager: MIN_CREDITS }).state).toBe("empty");
  });
});

describe("planFunding with a credits line", () => {
  it("enough credits: Alice's 5 credits fund a 3 sDAI prediction, nothing from her wallet", () => {
    const { funding, summary } = fund({ wallet: 5n * WAD, tradeWallet: 0n, manager: 1000n * WAD }, 3n * WAD, {
      ownWallet: 10n * WAD,
      tradeWallet: 0n,
    });

    expect(funding).toMatchObject({
      collateralIn: 3n * WAD,
      creditsIn: 3n * WAD,
      credits: [{ kind: "foresight", fromTradeWallet: 0n, fromWallet: 3n * WAD }],
      fromTradeWallet: 0n,
      toAdd: 0n,
      deposit: 0n,
    });
    expect(summary).toBe("≈ 3 sDAI from your credits");
  });

  it("partial credits: 2 credits and 10 sDAI fund 5 sDAI as 2 in credits and 3 from the wallet", () => {
    const { funding, summary } = fund({ wallet: 2n * WAD, tradeWallet: 0n, manager: 1000n * WAD }, 5n * WAD, {
      ownWallet: 10n * WAD,
      tradeWallet: 0n,
    });

    expect(funding).toMatchObject({ creditsIn: 2n * WAD, toAdd: 3n * WAD, deposit: 3n * WAD });
    expect(summary).toBe("≈ 5 sDAI = 2 in credits + 3 from your wallet");
  });

  it("spends the trade wallet's credits, then the wallet's, then the trade wallet's collateral, then the wallet", () => {
    const { funding, summary } = fund({ wallet: 2n * WAD, tradeWallet: 1n * WAD, manager: 1000n * WAD }, 10n * WAD, {
      ownWallet: 20n * WAD,
      tradeWallet: 4n * WAD,
    });

    expect(funding).toMatchObject({
      credits: [{ kind: "foresight", fromTradeWallet: 1n * WAD, fromWallet: 2n * WAD }],
      creditsIn: 3n * WAD,
      fromTradeWallet: 4n * WAD,
      toAdd: 3n * WAD,
    });
    expect(summary).toBe("≈ 10 sDAI = 3 in credits + 4 in your trade wallet + 3 from your wallet");
  });

  it("manager short: spends only the 200 credits it covers of 500, the rest from the wallet", () => {
    const { offer, funding } = fund({ wallet: 500n * WAD, tradeWallet: 0n, manager: 200n * WAD }, 300n * WAD, {
      ownWallet: 1000n * WAD,
      tradeWallet: 0n,
    });

    expect(offer).toMatchObject({ state: "short", usable: 200n * WAD });
    expect(funding).toMatchObject({ creditsIn: 200n * WAD, toAdd: 100n * WAD, creditsAvailable: 200n * WAD });
    expect(funding.available).toBe(1200n * WAD);
  });

  it("manager empty: no credits line, so the amount is the visitor's own collateral", () => {
    const { offer, funding, summary } = fund({ wallet: 5n * WAD, tradeWallet: 0n, manager: 0n }, 3n * WAD, {
      ownWallet: 10n * WAD,
      tradeWallet: 0n,
    });

    expect(offer.state).toBe("empty");
    expect(funding).toMatchObject({ credits: [], creditsIn: 0n, creditsAvailable: 0n, toAdd: 3n * WAD });
    expect(summary).toBe("3 sDAI from your wallet");
  });

  it("adds the usable credits to what can be put in, so Max and the over-balance check count them", () => {
    const { funding, summary } = fund({ wallet: 5n * WAD, tradeWallet: 0n, manager: 1000n * WAD }, 20n * WAD, {
      ownWallet: 10n * WAD,
      tradeWallet: 0n,
    });

    expect(funding.available).toBe(15n * WAD);
    expect(summary).toBe("Not enough balance. Max 15 sDAI.");
  });

  it("values credits paid in xDAI at the rate, and deposits xDAI only for the rest", () => {
    // 1.25 xDAI per sDAI: 10 xDAI is 8 sDAI, of which 2 come from credits
    const held = { wallet: 2n * WAD, tradeWallet: 0n, manager: 1000n * WAD };
    const funding = planFunding({
      amount: 10n * WAD,
      ownWallet: 20n * WAD,
      tradeWallet: 0n,
      tokenPerCollateralWad: (5n * WAD) / 4n,
      credits: creditLines(held, creditsOffer(held)),
    });

    expect(funding).toMatchObject({
      collateralIn: 8n * WAD,
      creditsIn: 2n * WAD,
      creditsAvailable: (5n * WAD) / 2n,
      toAdd: 6n * WAD,
      deposit: (15n * WAD) / 2n,
    });
    expect(fundingSummary({ funding, amount: 10n * WAD, token: xDai, collateral })?.text).toBe(
      "≈ 8 sDAI = 2 in credits + 6 from your wallet",
    );
  });
});
