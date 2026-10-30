// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { crc32, deflateSync, inflateSync } from "node:zlib";

import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";

import { decodePng, pngSize } from "./png";

const webRoot = path.resolve(import.meta.dirname, "../..");

const WIDTH = 7;
const HEIGHT = 5;

/**
 * Every channel varies with x and y.
 * Blue rises 1 a row and falls 2 a column, tying Paeth's up and up-left distances.
 */
function gradient(alpha: (x: number, y: number) => number) {
  const rgba = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      rgba.set(
        [(x * 37 + y * 91) & 0xff, (x * x * 13 + y * 29) & 0xff, 16 + y - 2 * x, alpha(x, y)],
        (y * WIDTH + x) * 4,
      );
    }
  }
  return rgba;
}

function encode(rgba: Uint8Array, options: { colorType: 2 | 6; filterType: number }) {
  const png = new PNG({ width: WIDTH, height: HEIGHT });
  png.data = Buffer.from(rgba);
  return PNG.sync.write(png, options);
}

function chunks(png: Buffer) {
  const found: { type: string; data: Buffer }[] = [];
  for (let offset = 8; offset < png.length; offset += 12 + png.readUInt32BE(offset)) {
    const length = png.readUInt32BE(offset);
    found.push({
      type: png.toString("ascii", offset + 4, offset + 8),
      data: png.subarray(offset + 8, offset + 8 + length),
    });
  }
  return found;
}

function chunk(type: string, data: Buffer) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** The filter byte that opens each scanline of the inflated image data. */
function rowFilters(png: Buffer, channels: number) {
  const raw = inflateSync(
    Buffer.concat(
      chunks(png)
        .filter(({ type }) => type === "IDAT")
        .map(({ data }) => data),
    ),
  );
  return Array.from({ length: HEIGHT }, (_, y) => raw[y * (WIDTH * channels + 1)]);
}

/** A valid PNG rebuilt with its IHDR bytes or its inflated image data edited; CRCs are recomputed. */
function rebuild(png: Buffer, edit: { ihdr?: (ihdr: Buffer) => void; raw?: (raw: Buffer) => void }) {
  const parts = chunks(png);
  const ihdr = Buffer.from(parts.find(({ type }) => type === "IHDR")!.data);
  edit.ihdr?.(ihdr);
  const raw = inflateSync(Buffer.concat(parts.filter(({ type }) => type === "IDAT").map(({ data }) => data)));
  edit.raw?.(raw);
  return Buffer.concat([
    png.subarray(0, 8),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("decodePng, against pngjs", () => {
  it.each([
    [0, "None"],
    [1, "Sub"],
    [2, "Up"],
    [3, "Average"],
    [4, "Paeth"],
  ])("recovers every RGBA pixel from rows written with filter %i (%s)", (filterType) => {
    // Alpha falls 2 a row and rises 1 a column, tying Paeth's left and up-left distances.
    const pixels = gradient((x, y) => 248 + x - 2 * y);
    const png = encode(pixels, { colorType: 6, filterType });

    expect(rowFilters(png, 4)).toEqual(Array<number>(HEIGHT).fill(filterType));
    expect(decodePng(png)).toEqual({ width: WIDTH, height: HEIGHT, rgba: pixels });
  });

  it("recovers RGB pixels with every alpha byte 255", () => {
    const pixels = gradient(() => 0xff);
    const png = encode(pixels, { colorType: 2, filterType: 4 });

    expect(png[25]).toBe(2);
    expect(decodePng(png)).toEqual({ width: WIDTH, height: HEIGHT, rgba: pixels });
  });

  it.each([
    ["src/app/icon1.png", "RGBA"],
    ["src/app/apple-icon.png", "RGB"],
    ["public/foresight-og.png", "RGB, image data split over many IDAT chunks"],
  ])("decodes %s (%s, written by Chromium) to the pixels pngjs reads", (file) => {
    const bytes = readFileSync(path.join(webRoot, file));
    const expected = PNG.sync.read(bytes);
    const decoded = decodePng(bytes);

    expect({ width: decoded.width, height: decoded.height }).toEqual({
      width: expected.width,
      height: expected.height,
    });
    expect(Buffer.compare(Buffer.from(decoded.rgba), expected.data)).toBe(0);
  });

  it("reads the size of a pngjs image", () => {
    expect(
      pngSize(
        encode(
          gradient(() => 0xff),
          { colorType: 6, filterType: 0 },
        ),
      ),
    ).toEqual({ width: WIDTH, height: HEIGHT });
  });

  it("refuses greyscale", () => {
    const png = new PNG({ width: WIDTH, height: HEIGHT });
    png.data = Buffer.from(gradient(() => 0xff));

    expect(() => decodePng(PNG.sync.write(png, { colorType: 0 }))).toThrow(/unsupported PNG: depth 8, colour type 0/);
  });
});

// pngjs writes neither 16-bit RGBA from 8-bit input, nor palettes, nor interlacing, nor unknown filters,
// so these are pngjs output with the IHDR or scanline bytes edited.
describe("decodePng, against PNGs no encoder here will write", () => {
  const valid = () =>
    encode(
      gradient(() => 0xff),
      { colorType: 6, filterType: 0 },
    );

  it("refuses a 16-bit image", () => {
    const png = rebuild(valid(), { ihdr: (ihdr) => (ihdr[8] = 16) });

    expect(() => decodePng(png)).toThrow(/unsupported PNG: depth 16/);
  });

  it("refuses a palette image", () => {
    const png = rebuild(valid(), { ihdr: (ihdr) => (ihdr[9] = 3) });

    expect(() => decodePng(png)).toThrow(/unsupported PNG: depth 8, colour type 3/);
  });

  it("refuses an interlaced image", () => {
    const png = rebuild(valid(), { ihdr: (ihdr) => (ihdr[12] = 1) });

    expect(() => decodePng(png)).toThrow(/interlace 1/);
  });

  it("refuses a scanline with an unknown filter", () => {
    const png = rebuild(valid(), { raw: (raw) => (raw[0] = 5) });

    expect(() => decodePng(png)).toThrow(/unknown PNG filter 5/);
  });

  it("refuses bytes that are not a PNG", () => {
    expect(() => decodePng(Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00;", "latin1"))).toThrow(/not a PNG/);
  });
});
