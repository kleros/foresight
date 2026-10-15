/** Room kept between the market's chip and the thumb's value pill, in px. */
export const PIN_CLEARANCE_PX = 4;

/** How far beyond the clearance the chip starts to dip, in px. */
export const PIN_PREFLIGHT_PX = 40;

/** The share of its full drop the chip dips before it drops, keeping it above the track. */
export const PIN_PREFLIGHT_DROP = 0.2;

/** Half the slider's 24px thumb. */
export const THUMB_RADIUS_PX = 12;

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/** The chip's left edge, centred on the market's point but kept on the track. */
export function chipLeft(size: { track: number; chip: number }, market: number): number {
  return clamp(market * size.track - size.chip / 2, 0, Math.max(size.track - size.chip, 0));
}

/**
 * Px between the chip and what the thumb draws, the pill and the thumb itself; negative when
 * they overlap. The pill's left edge sits at `thumb` of the track it does not cover, as its CSS places it.
 */
export function pinGap(
  size: { track: number; pill: number; chip: number },
  share: { thumb: number; market: number },
): number {
  if (size.track === 0) return share.thumb === share.market ? -1 : Number.POSITIVE_INFINITY;

  const centre = share.thumb * size.track;
  const pillLeft = share.thumb * (size.track - size.pill);
  const left = Math.min(pillLeft, centre - THUMB_RADIUS_PX);
  const right = Math.max(pillLeft + size.pill, centre + THUMB_RADIUS_PX);
  const chip = chipLeft(size, share.market);
  return Math.max(chip - right, left - (chip + size.chip));
}

/** How far down the pin sits, 0 to 1: a shallow dip across the preflight band, then the whole drop. */
export function pinDrop(gap: number): number {
  if (gap <= PIN_CLEARANCE_PX) return 1;
  return PIN_PREFLIGHT_DROP * clamp((PIN_CLEARANCE_PX + PIN_PREFLIGHT_PX - gap) / PIN_PREFLIGHT_PX, 0, 1);
}
