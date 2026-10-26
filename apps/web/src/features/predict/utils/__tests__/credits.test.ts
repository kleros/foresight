import { describe, expect, it } from "vitest";

import { OWNED_DECIMALS } from "@/utils/amount";

import type { CreditsHeld } from "@/lib/trade-executor/credits";

import { creditLines, creditsOffer, MIN_CREDITS } from "../credits";
import { fundingRequest, fundingSummary, planFunding, shownAmount, shownSplit } from "../funding";

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
    expect(creditsOffer({ wallet: 50n * WAD, tradeWallet: 0n, manager: 20n * WAD })).toEqual({
      state: "short",
      held: 50n * WAD,
      usable: 20n * WAD,
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

  it("manager short: spends only the 20 credits it covers of 50, the rest from the wallet", () => {
    const { offer, funding } = fund({ wallet: 50n * WAD, tradeWallet: 0n, manager: 20n * WAD }, 30n * WAD, {
      ownWallet: 1000n * WAD,
      tradeWallet: 0n,
    });

    expect(offer).toMatchObject({ state: "short", usable: 20n * WAD });
    expect(funding).toMatchObject({ creditsIn: 20n * WAD, toAdd: 10n * WAD, creditsAvailable: 20n * WAD });
    expect(funding.available).toBe(1020n * WAD);
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

describe("credits a run may spend", () => {
  it("offers every credit held, however many, when the manager covers them", () => {
    const held = { wallet: 5000n * WAD, tradeWallet: 250n * WAD, manager: 10_000n * WAD };

    expect(creditsOffer(held)).toEqual({ state: "usable", held: 5250n * WAD, usable: 5250n * WAD });
  });

  it("offers what the manager's collateral covers, and says the offer is short of what is held", () => {
    const held = { wallet: 300n * WAD, tradeWallet: 0n, manager: 120n * WAD };

    expect(creditsOffer(held)).toEqual({ state: "short", held: 300n * WAD, usable: 120n * WAD });
  });
});

describe("credits signed as shown", () => {
  const step = 10n ** BigInt(18 - OWNED_DECIMALS);

  it("spends each credit source in whole shown decimals, so the transfer and the burn are the figures shown", () => {
    // 1.23456789 in the trade wallet and 0.98765432 in the wallet
    const held = { wallet: 987_654_320_000_000_000n, tradeWallet: 1_234_567_890_000_000_000n, manager: 1000n * WAD };
    const funding = planFunding({
      amount: 5n * WAD,
      ownWallet: 10n * WAD,
      tradeWallet: 0n,
      credits: creditLines(held, creditsOffer(held)),
    });
    const [use] = funding.credits;

    expect(use).toEqual({ kind: "foresight", fromTradeWallet: 12_345n * step, fromWallet: 9_876n * step });
    expect(funding.creditsIn % step).toBe(0n);
    expect(shownAmount(funding.creditsIn, 18)).toBe("2.2221");
    expect(funding.toAdd).toBe(5n * WAD - funding.creditsIn);
  });

  it("drops what the cut leaves below a shown decimal rather than deposit it, when credits cover the rest", () => {
    // 2 xDAI at 1.2543 xDAI per sDAI is 1.594515... sDAI, cut to 1.5945 credits
    const held = { wallet: 6n * WAD, tradeWallet: 0n, manager: 1000n * WAD };
    const funding = planFunding({
      amount: 2n * WAD,
      ownWallet: 10n * WAD,
      tradeWallet: 0n,
      tokenPerCollateralWad: 1_254_300_000_000_000_000n,
      credits: creditLines(held, creditsOffer(held)),
    });

    expect(funding).toMatchObject({ creditsIn: 15_945n * step, collateralIn: 15_945n * step, toAdd: 0n, deposit: 0n });
    expect(fundingSummary({ funding, amount: 2n * WAD, token: xDai, collateral })?.text).toBe(
      "≈ 1.5945 sDAI from your credits",
    );
  });

  it("asks the run for the sDAI split apart from the credits, and the credits by source", () => {
    const held = { wallet: 2n * WAD, tradeWallet: WAD, manager: 1000n * WAD };
    const funding = planFunding({
      amount: 10n * WAD,
      ownWallet: 20n * WAD,
      tradeWallet: 4n * WAD,
      credits: creditLines(held, creditsOffer(held)),
    });

    expect(fundingRequest(funding, false)).toEqual({
      deposit: 3n * WAD,
      depositNative: false,
      collateralIn: 7n * WAD,
      collateralBefore: 4n * WAD,
      creditsFromEoa: 2n * WAD,
      creditsToSpend: 3n * WAD,
    });
  });

  it("counts only the credits the cut can spend as available, so an amount it accepts is covered", () => {
    // 1.00009 credits in the trade wallet and 0.00009 in the wallet: each cut spends 1 and 0
    const dust = 9n * 10n ** 13n;
    const line = { kind: "foresight" as const, tradeWallet: WAD + dust, wallet: dust, usable: WAD + 2n * dust };
    const money = { ownWallet: WAD, tradeWallet: 0n, credits: [line] };

    expect(planFunding({ amount: WAD, ...money }).creditsAvailable).toBe(WAD);
    const over = planFunding({ amount: 2n * WAD + step, ...money });
    expect(over.available).toBe(2n * WAD);

    // every amount the popup accepts asks for no more sDAI than the deposit and the trade wallet hold
    for (const amount of [2n * WAD, 2n * WAD - step, WAD + step, WAD / 2n]) {
      const funding = planFunding({ amount, ...money });
      expect(amount).toBeLessThanOrEqual(funding.available);
      const request = fundingRequest(funding, false);
      expect(request.collateralIn).toBeLessThanOrEqual(request.deposit + funding.fromTradeWallet);
    }
  });

  it("asks for no credits when none are ticked", () => {
    const funding = planFunding({ amount: 10n * WAD, ownWallet: 20n * WAD, tradeWallet: 0n });

    expect(fundingRequest(funding, true)).toMatchObject({
      depositNative: true,
      collateralIn: 10n * WAD,
      creditsFromEoa: 0n,
      creditsToSpend: 0n,
    });
  });
});

describe("the split each option is shown to make", () => {
  const held = { wallet: 4n * WAD, tradeWallet: 0n, manager: 1000n * WAD };
  const withCredits = () =>
    planFunding({
      amount: 10n * WAD,
      ownWallet: 20n * WAD,
      tradeWallet: 0n,
      credits: creditLines(held, creditsOffer(held)),
    });

  it("counts the sDAI as is and the credits at what their swap's floor mints", () => {
    expect(shownSplit(withCredits(), 3n * WAD)).toBe(6n * WAD + 3n * WAD);
    expect(shownSplit(planFunding({ amount: 10n * WAD, ownWallet: 20n * WAD, tradeWallet: 0n }), undefined)).toBe(
      10n * WAD,
    );
  });

  it("is unknown while the credits swap has no quote", () => {
    expect(shownSplit(withCredits(), undefined)).toBeUndefined();
  });
});

describe("credits funding boundaries", () => {
  it("uses only the remaining request from wallet credits", () => {
    const { funding } = fund({ wallet: 5n * WAD, tradeWallet: 2n * WAD, manager: 7n * WAD }, 3n * WAD);
    expect(funding).toMatchObject({
      collateralIn: 3n * WAD,
      creditsIn: 3n * WAD,
      credits: [{ kind: "foresight", fromTradeWallet: 2n * WAD, fromWallet: WAD }],
      deposit: 0n,
    });
  });
  it("retains one displayed collateral quantum after spending credits", () => {
    const quantum = 10n ** BigInt(18 - OWNED_DECIMALS);
    const { funding } = fund({ wallet: WAD, tradeWallet: 0n, manager: WAD }, WAD + quantum, {
      ownWallet: WAD,
      tradeWallet: 0n,
    });
    expect(funding).toMatchObject({ collateralIn: WAD + quantum, toAdd: quantum, deposit: quantum });
  });
  it("does not forgive collateral dust when selected credits contribute nothing", () => {
    const funding = planFunding({
      amount: 1n,
      ownWallet: WAD,
      tradeWallet: 0n,
      credits: [{ kind: "foresight", wallet: 0n, tradeWallet: 0n, usable: 0n }],
    });
    expect(funding).toMatchObject({ collateralIn: 1n, toAdd: 1n, deposit: 1n });
  });
});
