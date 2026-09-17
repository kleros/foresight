import { describe, expect, it } from "vitest";

import { addresses } from "@/testing/fixtures";
import type { OptionScale } from "@/types/optionScale";

import { parseEstimateCsv, serializeEstimateCsv } from "../estimateCsv";

const [FIRST, SECOND] = addresses.childMarkets;

const villeneuve: OptionScale = {
  market: FIRST,
  name: "Villeneuve",
  color: "#009aff",
  unit: "$M",
  lowerBound: 0,
  upperBound: 500,
};
const gerwig: OptionScale = {
  market: SECOND,
  name: "Gerwig, Greta",
  color: "#ff0000",
  unit: "$M",
  lowerBound: 0,
  upperBound: 500,
};
const scales = [villeneuve, gerwig];

describe("parseEstimateCsv rows", () => {
  it("splits rows on either line ending", () => {
    expect(parseEstimateCsv('name,estimate\r\nVilleneuve,250\n"Gerwig, Greta",300', scales)).toEqual([
      { scale: villeneuve, value: 250 },
      { scale: gerwig, value: 300 },
    ]);
  });

  it("keeps commas and doubled quotes inside a quoted field", () => {
    const quoted = { ...gerwig, name: 'Gerwig, "Greta"' };

    expect(parseEstimateCsv('name,estimate\n"Gerwig, ""Greta""",300', [villeneuve, quoted])).toEqual([
      { scale: quoted, value: 300 },
    ]);
  });

  it("skips blank lines", () => {
    expect(parseEstimateCsv("name,estimate\n\n  ,\nVilleneuve,250\n", scales)).toEqual([
      { scale: villeneuve, value: 250 },
    ]);
  });
});

describe("serializeEstimateCsv", () => {
  it("writes the header and quotes a name that carries a comma", () => {
    const csv = serializeEstimateCsv([
      { name: "Villeneuve", estimate: 250 },
      { name: "Gerwig, Greta", estimate: 300.5 },
    ]);

    expect(csv).toBe('name,estimate\nVilleneuve,250\n"Gerwig, Greta",300.5');
  });

  it("round-trips through the parser", () => {
    const csv = serializeEstimateCsv([
      { name: "Villeneuve", estimate: 250 },
      { name: "Gerwig, Greta", estimate: 300 },
    ]);

    expect(parseEstimateCsv(csv, scales)).toEqual([
      { scale: villeneuve, value: 250 },
      { scale: gerwig, value: 300 },
    ]);
  });
});

describe("parseEstimateCsv", () => {
  it("matches names without regard to case or surrounding spaces", () => {
    expect(parseEstimateCsv("name,estimate\n  villeneuve ,250", scales)).toEqual([{ scale: villeneuve, value: 250 }]);
  });

  it("accepts the columns in either order", () => {
    expect(parseEstimateCsv("estimate,name\n250,Villeneuve", scales)).toEqual([{ scale: villeneuve, value: 250 }]);
  });

  it("keeps the last row when an option appears twice", () => {
    expect(parseEstimateCsv("name,estimate\nVilleneuve,250\nVilleneuve,260", scales)).toEqual([
      { scale: villeneuve, value: 260 },
    ]);
  });

  it("refuses a header without both columns", () => {
    expect(() => parseEstimateCsv("option,score\nVilleneuve,250", scales)).toThrow(
      "exactly two columns: name,estimate",
    );
  });

  it("refuses a header with a third column", () => {
    expect(() => parseEstimateCsv("name,estimate,note\nVilleneuve,250,x", scales)).toThrow("exactly two columns");
  });

  it("refuses an estimate finer than the scale's step rather than rounding it", () => {
    expect(() => parseEstimateCsv("name,estimate\nVilleneuve,312.37", scales)).toThrow(
      "Row 2: Villeneuve moves in steps of 1, so 312.37 is not a value it can take.",
    );
  });

  it("reads a scale in the tens of thousands, whose step is a hundred", () => {
    const wide: OptionScale = { ...villeneuve, lowerBound: 0, upperBound: 10_000 };

    expect(parseEstimateCsv("name,estimate\nVilleneuve,4300", [wide])).toEqual([{ scale: wide, value: 4300 }]);
    expect(() => parseEstimateCsv("name,estimate\nVilleneuve,4321", [wide])).toThrow("steps of 100");
    // a thousands separator survives only inside quotes, and is then not a number
    expect(() => parseEstimateCsv('name,estimate\nVilleneuve,"4,300"', [wide])).toThrow('"4,300" is not a number');
  });

  it("refuses a file with only a header", () => {
    expect(() => parseEstimateCsv("name,estimate\n", scales)).toThrow("no rows");
  });

  it("names the row that has no option by that name", () => {
    expect(() => parseEstimateCsv("name,estimate\nVilleneuve,250\nNolan,250", scales)).toThrow(
      'Row 3: there is no option named "Nolan"',
    );
  });

  it("names the row whose estimate is not a number", () => {
    expect(() => parseEstimateCsv("name,estimate\nVilleneuve,lots", scales)).toThrow('Row 2: "lots" is not a number');
  });

  it("names the row whose estimate is off the option's scale", () => {
    expect(() => parseEstimateCsv("name,estimate\nVilleneuve,501", scales)).toThrow(
      "Row 2: Villeneuve takes 0 to 500, not 501",
    );
  });

  it("names the row missing a value", () => {
    expect(() => parseEstimateCsv("name,estimate\nVilleneuve,", scales)).toThrow("Row 2: both columns need a value");
  });
});
