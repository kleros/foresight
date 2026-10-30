import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { decodePng, pngSize } from "@/test/png";

import { defaultOgImage } from "../metadata";

// config/env validates the whole environment at import; only SITE_URL is read here.
vi.mock("../env", () => ({ env: {} }));

const webRoot = path.resolve(import.meta.dirname, "../../..");
const appDir = path.join(webRoot, "src/app");

function gitBlobHash(bytes: Buffer) {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

/** The portrait-in-a-hexagon icons this app shipped with, shared with futarchy-ui. */
const PORTRAIT_ICONS = {
  "favicon.ico": "64aac3906368d13129e1b7c0e9d69f2f30daa36a",
  "icon0.svg": "2e9f2945f9830831e10c6eb381e7e62f328f7686",
  "icon1.png": "d63709d41e249ac03883f2fb2402313ac670ce23",
  "apple-icon.png": "5be3a9a5e09c5ff4087ae81e6729ffa4a08534e3",
};

describe("default share image", () => {
  const file = path.join(webRoot, "public", defaultOgImage);

  it("is 1200x630, the size Open Graph and Twitter cards render", () => {
    expect(pngSize(readFileSync(file))).toEqual({ width: 1200, height: 630 });
  });

  it("is described by the size comment above it", () => {
    const source = readFileSync(path.join(webRoot, "src/config/metadata.ts"), "utf8");
    const { width, height } = pngSize(readFileSync(file));

    expect(source).toMatch(new RegExp(`/\\*\\* [^*]*\\b${width}x${height}\\b[^*]*\\*/\\s*export const defaultOgImage`));
  });
});

describe("app icons", () => {
  it.each(Object.entries(PORTRAIT_ICONS))("%s is no longer the portrait", (name, portraitHash) => {
    expect(gitBlobHash(readFileSync(path.join(appDir, name)))).not.toBe(portraitHash);
  });

  it("icon0.svg is the foresight mark as vectors, not an embedded bitmap", () => {
    const svg = readFileSync(path.join(appDir, "icon0.svg"), "utf8");
    const mark = readFileSync(path.join(webRoot, "src/assets/logo/foresight-mark.svg"), "utf8");

    expect(svg).not.toContain("<image");
    expect(svg).toBe(mark);
  });

  it.each([
    ["icon1.png", 96],
    ["apple-icon.png", 180],
  ])("%s is %ipx square", (name, size) => {
    expect(pngSize(readFileSync(path.join(appDir, name)))).toEqual({ width: size, height: size });
  });

  it("favicon.ico holds 16, 32 and 48px images", () => {
    const ico = readFileSync(path.join(appDir, "favicon.ico"));
    const count = ico.readUInt16LE(4);
    const sizes = Array.from({ length: count }, (_, i) => ico[6 + i * 16] || 256);

    expect(ico.readUInt16LE(2)).toBe(1);
    expect(sizes).toEqual([16, 32, 48]);
  });
});

const MARK_SVG = readFileSync(path.join(webRoot, "src/assets/logo/foresight-mark.svg"), "utf8");
const WHITE = [255, 255, 255] as const;
/** Per-channel distance under which a pixel counts as a given colour; covers anti-aliasing. */
const COLOUR_TOLERANCE = 24;

/** The mark's fill colours other than white, as RGB. */
const MARK_COLOURS = [...MARK_SVG.matchAll(/fill="#([0-9a-fA-F]{6})"/g)].map(([, hex = ""]) =>
  [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)),
);

/** Extent of every point the mark's paths name, in viewBox units. */
function markExtent(svg: string) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [, d = ""] of svg.matchAll(/<path d="([^"]+)"/g)) {
    for (const [, command = "", operands = ""] of d.matchAll(/([A-Za-z])([^A-Za-z]*)/g)) {
      const numbers = (operands.match(/-?\d*\.?\d+/g) ?? []).map(Number);
      if (command === "V") ys.push(...numbers);
      else if (command === "H") xs.push(...numbers);
      else if ("MLC".includes(command)) numbers.forEach((n, i) => (i % 2 ? ys : xs).push(n));
      else if (command !== "Z") throw new Error(`path command ${command} is not handled`);
    }
  }
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}

function isColour(rgba: Uint8Array, at: number, colour: readonly number[]) {
  return colour.every((channel, i) => Math.abs((rgba[at + i] ?? 0) - channel) <= COLOUR_TOLERANCE);
}

/** Pixels that are at least half opaque and not white: the artwork, without background or arrow. */
function artwork(png: Uint8Array) {
  const { width, height, rgba } = decodePng(png);
  let ink = 0;
  let onMark = 0;
  const box = { left: width, right: -1, top: height, bottom: -1 };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      if ((rgba[at + 3] ?? 0) < 128 || isColour(rgba, at, WHITE)) continue;
      ink++;
      if (MARK_COLOURS.some((colour) => isColour(rgba, at, colour))) onMark++;
      box.left = Math.min(box.left, x);
      box.right = Math.max(box.right, x + 1);
      box.top = Math.min(box.top, y);
      box.bottom = Math.max(box.bottom, y + 1);
    }
  }
  return { width, height, coverage: ink / (width * height), onMark: onMark / ink, box };
}

/** Each entry's image bytes; the 16-byte directory entries hold length at 8 and offset at 12. */
function icoImages(ico: Buffer) {
  return Array.from({ length: ico.readUInt16LE(4) }, (_, i) => {
    const entry = 6 + i * 16;
    const offset = ico.readUInt32LE(entry + 12);
    return ico.subarray(offset, offset + ico.readUInt32LE(entry + 8));
  });
}

const rasterIcons = [
  ["icon1.png", readFileSync(path.join(appDir, "icon1.png"))],
  ["apple-icon.png", readFileSync(path.join(appDir, "apple-icon.png"))],
  ...icoImages(readFileSync(path.join(appDir, "favicon.ico"))).map(
    (png, i) => [`favicon.ico image ${i}`, png] as const,
  ),
] as const;

describe("raster app icons, against foresight-mark.svg", () => {
  const mark = markExtent(MARK_SVG);

  it.each(rasterIcons)("%s is painted in the mark's colours", (_, png) => {
    expect(artwork(png).onMark).toBeGreaterThan(0.8);
  });

  it.each(rasterIcons)("%s is not blank", (_, png) => {
    expect(artwork(png).coverage).toBeGreaterThan(0.2);
  });

  it.each(rasterIcons)("%s has the mark's proportions", (_, png) => {
    const { box } = artwork(png);
    const height = box.bottom - box.top;
    const markAspect = (mark.right - mark.left) / (mark.bottom - mark.top);

    // A pixel of rounding at each edge.
    expect(Math.abs((box.right - box.left) / height - markAspect)).toBeLessThanOrEqual(2 / height);
  });

  it.each(rasterIcons)("%s centres the mark", (_, png) => {
    const { width, height, box } = artwork(png);
    const [, viewWidth = NaN, viewHeight = NaN] = (MARK_SVG.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/) ?? []).map(Number);

    expect(Math.abs((box.left + box.right) / 2 / width - (mark.left + mark.right) / 2 / viewWidth)).toBeLessThanOrEqual(
      1 / width,
    );
    expect(
      Math.abs((box.top + box.bottom) / 2 / height - (mark.top + mark.bottom) / 2 / viewHeight),
    ).toBeLessThanOrEqual(1 / height);
  });
});
