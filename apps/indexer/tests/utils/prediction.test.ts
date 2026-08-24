import { describe, it } from "vitest";

import { underlyingPerOutcome } from "../../src/utils/poolPrice";
import { derivePrediction } from "../../src/utils/prediction";

const WAD = 10n ** 18n;

/** Swap totals with only the UP side moved; signs are the executor's: spent negative, received positive. */
const upOnly = (underlying: bigint, tokens: bigint) => ({
  upSwapUnderlying: underlying,
  upSwapTokens: tokens,
  downSwapUnderlying: 0n,
  downSwapTokens: 0n,
});

describe("derivePrediction", () => {
  it("prices a buy and a sell of the same fill identically", (t) => {
    t.expect(derivePrediction(upOnly(-40n, 100n), 0n, 100n).impliedPrediction).toBe(40n);
    t.expect(derivePrediction(upOnly(40n, -100n), 0n, 100n).impliedPrediction).toBe(40n);
  });

  it("refuses a round trip whose tokens netted to zero", (t) => {
    const derived = derivePrediction(upOnly(5n, 0n), 0n, 100n);
    t.expect(derived.upAvgPrice).toBeUndefined();
    t.expect(derived.impliedPrediction).toBeUndefined();
  });

  it("refuses totals that ended up same-sign", (t) => {
    // sold 100 for 45 then re-bought 103 for 40: more tokens AND more underlying
    const derived = derivePrediction(upOnly(5n, 3n), 0n, 100n);
    t.expect(derived.upAvgPrice).toBeUndefined();
    t.expect(derived.impliedPrediction).toBeUndefined();
  });

  it("prices the net flow when a side was partly bought back", (t) => {
    // buy 100 for 40, sell 60 back for 30: the net 40 tokens cost a net 10
    t.expect(derivePrediction(upOnly(-10n, 40n), 0n, 100n).impliedPrediction).toBe(25n);
  });

  it("takes the forecast from the UP side when both sides priced", (t) => {
    // UP says 40; DOWN at the same ratio would mirror to 60
    const bothAtFourTenths = {
      upSwapUnderlying: -40n,
      upSwapTokens: 100n,
      downSwapUnderlying: -40n,
      downSwapTokens: 100n,
    };
    t.expect(derivePrediction(bothAtFourTenths, 0n, 100n).impliedPrediction).toBe(40n);
  });

  it("scales the forecast onto the market's own bounds", (t) => {
    t.expect(derivePrediction(upOnly(-40n, 100n), 1_000n, 2_000n).impliedPrediction).toBe(1_400n);
  });
});

describe("underlyingPerOutcome", () => {
  it("refuses a pool that has never been priced", (t) => {
    t.expect(underlyingPerOutcome(0n, false)).toBeUndefined();
  });

  it("reads the ratio through the pool's own token order", (t) => {
    // sqrt 2^97 is a token1-per-token0 ratio of four
    t.expect(underlyingPerOutcome(2n ** 97n, true)).toBe(4n * WAD);
    t.expect(underlyingPerOutcome(2n ** 97n, false)).toBe(WAD / 4n);
  });
});
