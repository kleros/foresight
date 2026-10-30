import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { defaultOgImage } from "../metadata";

// config/env validates the whole environment at import; only SITE_URL is read here.
vi.mock("../env", () => ({ env: {} }));

const webRoot = path.resolve(import.meta.dirname, "../../..");
const appDir = path.join(webRoot, "src/app");

/** Width and height from a PNG's IHDR chunk, big-endian at bytes 16 and 20. */
function pngSize(bytes: Buffer) {
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

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
