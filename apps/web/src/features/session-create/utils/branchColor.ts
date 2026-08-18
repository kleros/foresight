const LIGHT_SURFACE = "#ffffff";
const DARK_SURFACE = "#220050";
const CONTRAST_FLOOR = 1.9;

/** Hues this far apart never repeat and never cluster, for any count. */
const GOLDEN_ANGLE = 137.508;
/** Where the sequence starts, which is the violet the first branch has always been. */
const FIRST_HUE = 271;
const SATURATION = 0.85;
/**
 * One luminance for every hue, so the branches read as one family, and so the
 * legible band is a property of the sequence rather than of each colour.
 */
const TARGET_LUMINANCE = 0.2;

const HEX_RE = /^#[0-9a-f]{6}$/i;

function channelLuminance(channel: number): number {
  const unit = channel / 255;
  return unit <= 0.03928 ? unit / 12.92 : Math.pow((unit + 0.055) / 1.055, 2.4);
}

function luminance([r = 0, g = 0, b = 0]: number[]): number {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

function hexLuminance(hex: string): number {
  return luminance([0, 2, 4].map((i) => parseInt(hex.slice(1 + i, 3 + i), 16)));
}

function contrastRatio(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function isLegibleBranchColor(color: string): boolean {
  if (!HEX_RE.test(color)) return false;
  const lit = hexLuminance(color);
  return (
    contrastRatio(lit, hexLuminance(LIGHT_SURFACE)) >= CONTRAST_FLOOR &&
    contrastRatio(lit, hexLuminance(DARK_SURFACE)) >= CONTRAST_FLOOR
  );
}

function hslToRgb(hue: number, saturation: number, lightness: number): number[] {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const second = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const base = lightness - chroma / 2;
  const [r = 0, g = 0, b = 0] = (
    [
      [chroma, second, 0],
      [second, chroma, 0],
      [0, chroma, second],
      [0, second, chroma],
      [second, 0, chroma],
      [chroma, 0, second],
    ] as const
  )[Math.floor(hue / 60) % 6] ?? [0, 0, 0];
  return [r, g, b].map((part) => Math.round((part + base) * 255));
}

/**
 * The lightness at which this hue carries `TARGET_LUMINANCE`. Luminance rises
 * with lightness at a fixed hue, so halving the interval converges on it.
 */
function lightnessFor(hue: number): number {
  let low = 0;
  let high = 1;
  for (let step = 0; step < 20; step++) {
    const mid = (low + high) / 2;
    if (luminance(hslToRgb(hue, SATURATION, mid)) < TARGET_LUMINANCE) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/** The colour for the nth branch, deterministic. */
export function branchColor(index: number): string {
  const hue = (FIRST_HUE + index * GOLDEN_ANGLE) % 360;
  const hex = hslToRgb(hue, SATURATION, lightnessFor(hue))
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("");
  return `#${hex}`;
}

/** The first colour of the sequence nothing has taken yet. */
export function nextBranchColor(taken: readonly string[]): string {
  for (let index = 0; index < taken.length; index++) {
    const color = branchColor(index);
    if (!taken.includes(color)) return color;
  }
  return branchColor(taken.length);
}
