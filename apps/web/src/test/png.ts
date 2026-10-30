import { inflateSync } from "node:zlib";

export interface DecodedPng {
  width: number;
  height: number;
  /** Four bytes a pixel, row-major; RGB images get alpha 255. */
  rgba: Uint8Array;
}

/** Width and height from a PNG's IHDR chunk, big-endian at bytes 16 and 20. */
export function pngSize(bytes: Uint8Array) {
  const view = Buffer.from(bytes);
  if (view.subarray(1, 4).toString("ascii") !== "PNG") throw new Error("not a PNG");
  return { width: view.readUInt32BE(16), height: view.readUInt32BE(20) };
}

function paeth(left: number, up: number, upLeft: number) {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toUpLeft = Math.abs(estimate - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) return left;
  return toUp <= toUpLeft ? up : upLeft;
}

/**
 * Decodes the PNGs Chromium screenshots write: 8-bit RGB or RGBA, not interlaced.
 * Anything else throws rather than decoding wrong.
 */
export function decodePng(bytes: Uint8Array): DecodedPng {
  const png = Buffer.from(bytes);
  const { width, height } = pngSize(png);
  const [depth, colourType, , , interlace] = png.subarray(24, 29);
  if (depth !== 8 || (colourType !== 2 && colourType !== 6) || interlace !== 0) {
    throw new Error(`unsupported PNG: depth ${depth}, colour type ${colourType}, interlace ${interlace}`);
  }

  const idat: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    if (png.toString("ascii", offset + 4, offset + 8) === "IDAT") {
      idat.push(png.subarray(offset + 8, offset + 8 + length));
    }
    offset += 12 + length;
  }

  const channels = colourType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? -1;
    const line = Uint8Array.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? (line[x - channels] ?? 0) : 0;
      const up = previous[x] ?? 0;
      const upLeft = x >= channels ? (previous[x - channels] ?? 0) : 0;
      const predictor = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][filter];
      if (predictor === undefined) throw new Error(`unknown PNG filter ${filter}`);
      line[x] = ((line[x] ?? 0) + predictor) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      rgba.set(line.subarray(x * channels, x * channels + 3), at);
      rgba[at + 3] = channels === 4 ? (line[x * channels + 3] ?? 0) : 0xff;
    }
    previous = line;
  }

  return { width, height, rgba };
}
