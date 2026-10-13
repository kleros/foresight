import { describe, expect, it } from "vitest";

import type { PredictOption } from "@/features/predict/flow/types";
import type { SelectedEstimate } from "@/features/predict/types";
import type { SessionDetail } from "@/features/sessions/types";
import { sessionChildRow, sessionDetailColumns } from "@/features/sessions/utils/__tests__/fixtures";
import { toSessionDetail, type SessionDetailRow } from "@/features/sessions/utils/toSessionDetail";

import { MAX_PRICE_WAD, MIN_PRICE_WAD } from "@/utils/optionPrice";

import { addresses, GATEWAY } from "@/testing/fixtures";

import { toPredictOptions, toSavedEstimates } from "../toPredictOptions";

type ChildRow = SessionDetailRow["children"][number];

const [FIRST, SECOND] = addresses.childMarkets;
const SECOND_UP = "0x1111111111111111111111111111111111111111";
const SECOND_DOWN = "0x2222222222222222222222222222222222222222";
const SECOND_UNDERLYING = "0x3333333333333333333333333333333333333333";
const SECOND_INVALID = "0x4444444444444444444444444444444444444444";

const WAD = 10n ** 18n;
const wad = (units: number) => (BigInt(units) * WAD).toString();

const second = (overrides: Partial<ChildRow> = {}) =>
  sessionChildRow({
    id: SECOND,
    parentOutcomeIndex: "2",
    upToken: SECOND_UP,
    downToken: SECOND_DOWN,
    underlyingToken: SECOND_UNDERLYING,
    invalidToken: SECOND_INVALID,
    ...overrides,
  });

const session = (children: ChildRow[] = [sessionChildRow(), second()]) =>
  toSessionDetail({ ...sessionDetailColumns, children }, GATEWAY);

/** What the store hands the runner for an estimate on `market`, in that option's own unit. */
const estimateOn = (detail: SessionDetail, market: string, value: number): SelectedEstimate => {
  const scale = detail.options.find((option) => option.market === market);
  if (!scale) throw new Error(`no option ${market} in the fixture`);
  return { scale, value, marketEstimate: scale.lowerBound, direction: "higher" };
};

describe("toPredictOptions, against a session with every token read", () => {
  it("carries the child market and its four tokens with the estimate as an UP price", () => {
    const detail = session();

    // the director scale runs 0 to 500, so 312 sits 62.4% of the way up
    expect(toPredictOptions(detail, [estimateOn(detail, FIRST, 312)])).toEqual([
      {
        childMarket: FIRST,
        underlying: addresses.underlyingToken,
        upToken: addresses.upToken,
        downToken: addresses.downToken,
        invalidToken: addresses.childInvalidToken,
        targetPriceWad: 624n * 10n ** 15n,
      },
    ]);
  });

  it("burns each child's own INVALID, never the decision's", () => {
    const detail = session();

    const options = toPredictOptions(detail, [estimateOn(detail, FIRST, 100), estimateOn(detail, SECOND, 100)]);

    expect(options.map((option) => option.invalidToken)).toEqual([addresses.childInvalidToken, SECOND_INVALID]);
    expect(options.map((option) => option.invalidToken)).not.toContain(detail.invalidToken);
  });

  it("keeps each option's own tokens when several are selected, in the order they were selected", () => {
    const detail = session();

    const options = toPredictOptions(detail, [estimateOn(detail, SECOND, 400), estimateOn(detail, FIRST, 100)]);

    expect(options).toEqual([
      {
        childMarket: SECOND,
        underlying: SECOND_UNDERLYING,
        upToken: SECOND_UP,
        downToken: SECOND_DOWN,
        invalidToken: SECOND_INVALID,
        targetPriceWad: 8n * 10n ** 17n,
      },
      {
        childMarket: FIRST,
        underlying: addresses.underlyingToken,
        upToken: addresses.upToken,
        downToken: addresses.downToken,
        invalidToken: addresses.childInvalidToken,
        targetPriceWad: 2n * 10n ** 17n,
      },
    ]);
  });

  it("returns nothing for nothing selected", () => {
    expect(toPredictOptions(session(), [])).toEqual([]);
  });
});

describe("toPredictOptions, against missing token metadata", () => {
  const missing = ["upToken", "downToken", "underlyingToken", "invalidToken"] as const;

  it.each(missing)("drops an option whose %s did not read and keeps its complete sibling", (field) => {
    const detail = session([sessionChildRow(), second({ [field]: "" })]);

    const options = toPredictOptions(detail, [estimateOn(detail, FIRST, 312), estimateOn(detail, SECOND, 312)]);

    expect(options.map((option) => option.childMarket)).toEqual([FIRST]);
  });

  it("drops every option when none has its tokens", () => {
    const detail = session([sessionChildRow({ upToken: "" }), second({ invalidToken: "" })]);

    expect(toPredictOptions(detail, [estimateOn(detail, FIRST, 312), estimateOn(detail, SECOND, 312)])).toEqual([]);
  });

  it("drops an estimate on a market the session does not list", () => {
    const detail = session();
    const stray: SelectedEstimate = {
      ...estimateOn(detail, FIRST, 312),
      scale: { ...estimateOn(detail, FIRST, 312).scale, market: addresses.deployer },
    };

    expect(toPredictOptions(detail, [stray, estimateOn(detail, SECOND, 250)]).map((o) => o.childMarket)).toEqual([
      SECOND,
    ]);
  });
});

describe("toPredictOptions, converting estimates to prices", () => {
  // expected prices are worked by hand: (estimate - lower) / (upper - lower), in 1e18
  it.each([
    { lower: 0, upper: 500, estimate: 250, price: 5n * 10n ** 17n },
    { lower: 0, upper: 500, estimate: 312, price: 624n * 10n ** 15n },
    { lower: 100, upper: 200, estimate: 150, price: 5n * 10n ** 17n },
    { lower: 100, upper: 200, estimate: 125, price: 25n * 10n ** 16n },
    { lower: 0, upper: 3, estimate: 1, price: WAD / 3n },
  ])("prices $estimate on a $lower..$upper scale at $price", ({ lower, upper, estimate, price }) => {
    const detail = session([sessionChildRow({ lowerBound: wad(lower), upperBound: wad(upper) })]);

    expect(toPredictOptions(detail, [estimateOn(detail, FIRST, estimate)])[0]?.targetPriceWad).toBe(price);
  });

  it.each([
    { estimate: 0, price: MIN_PRICE_WAD },
    { estimate: -50, price: MIN_PRICE_WAD },
    { estimate: 500, price: MAX_PRICE_WAD },
    { estimate: 900, price: MAX_PRICE_WAD },
  ])("stops an estimate of $estimate short of the scale's bound", ({ estimate, price }) => {
    const detail = session();

    expect(toPredictOptions(detail, [estimateOn(detail, FIRST, estimate)])[0]?.targetPriceWad).toBe(price);
  });

  it("never prices outside the tradeable band and never lowers the price for a higher estimate", () => {
    const detail = session([sessionChildRow({ lowerBound: wad(20), upperBound: wad(80) })]);

    let previous = -1n;
    for (let step = 0; step <= 1200; step += 1) {
      const estimate = step / 10;
      const [option] = toPredictOptions(detail, [estimateOn(detail, FIRST, estimate)]);
      const price = option?.targetPriceWad;
      if (price === undefined) throw new Error(`no option for ${estimate}`);

      expect(typeof price).toBe("bigint");
      expect(price).toBeGreaterThanOrEqual(MIN_PRICE_WAD);
      expect(price).toBeLessThanOrEqual(MAX_PRICE_WAD);
      expect(price).toBeGreaterThanOrEqual(previous);
      previous = price;
    }
  });
});

describe("toSavedEstimates, a stored run's options as estimates", () => {
  const LOWER = "0xcccccccccccccccccccccccccccccccccccccccc";
  const UPPER = "0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";

  const storedOn = (childMarket: string): PredictOption => ({
    childMarket: childMarket as PredictOption["childMarket"],
    underlying: addresses.underlyingToken,
    upToken: addresses.upToken,
    downToken: addresses.downToken,
    invalidToken: addresses.childInvalidToken,
    targetPriceWad: 5n * 10n ** 17n,
  });

  it.each([
    { stored: UPPER, listed: LOWER },
    { stored: LOWER, listed: UPPER },
  ])("finds the option stored as $stored on the session's $listed", ({ stored, listed }) => {
    const detail = session([sessionChildRow({ id: listed })]);

    // the director scale runs 0 to 500, so a 0.5 price is 250
    expect(toSavedEstimates(detail, [storedOn(stored)])).toEqual([{ scale: detail.options[0], value: 250 }]);
  });

  it("drops a stored option on a market the session does not list", () => {
    const detail = session([sessionChildRow()]);

    expect(toSavedEstimates(detail, [storedOn(addresses.deployer)])).toEqual([]);
  });
});
