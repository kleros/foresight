/** Room kept between the market's chip and the thumb's value pill, in px. */
const PIN_CLEARANCE_PX = 4;

/** How far beyond the clearance the chip starts to dip, in px. */
const PIN_PREFLIGHT_PX = 40;

/** The share of its full drop the chip dips before it drops, keeping it above the track. */
export const PIN_PREFLIGHT_DROP = 0.2;

/** How far the market's point may lie outside a dropped chip's edge: the stick's 3px width. */
const PIN_EDGE_PX = 3;

/** Half the slider's 24px thumb. */
const THUMB_RADIUS_PX = 12;

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/** The chip's left edge, centred on the market's point but kept on the track. */
export function chipLeft(size: { track: number; chip: number }, market: number): number {
  return clamp(market * size.track - size.chip / 2, 0, Math.max(size.track - size.chip, 0));
}

/**
 * A dropped chip's left edge: centred as `chipLeft` places it, slid clear of the bound labels while it
 * still spans the market's point, give or take `PIN_EDGE_PX`; centred where it cannot do both.
 */
export function droppedChipLeft(
  size: { track: number; chip: number; lower: number; upper: number },
  market: number,
): number {
  const centred = chipLeft(size, market);
  const point = market * size.track;
  const low = Math.max(size.lower + PIN_CLEARANCE_PX, point - size.chip - PIN_EDGE_PX);
  const high = Math.min(size.track - size.upper - PIN_CLEARANCE_PX - size.chip, point + PIN_EDGE_PX);
  return low > high ? centred : clamp(centred, low, high);
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

/**
 * The widest the open field can be with its edge `PIN_CLEARANCE_PX` short of the raised chip, in px. The field's
 * left edge sits at `thumb` of the track it does not cover, so it grows towards the chip by `1 - thumb` of its width.
 * Wider than the closed pill wherever `pinGap` leaves the chip raised, as the pill then already clears it.
 */
export function fieldMaxWidth(size: { track: number; chip: number }, share: { thumb: number; market: number }): number {
  if (size.track === 0) return Number.POSITIVE_INFINITY;
  const centre = share.thumb * size.track;
  const chip = chipLeft(size, share.market);
  return chip > centre
    ? (chip - PIN_CLEARANCE_PX - centre) / (1 - share.thumb)
    : (centre - chip - size.chip - PIN_CLEARANCE_PX) / share.thumb;
}

/** How far down the pin sits, 0 to 1: a shallow dip across the preflight band, then the whole drop. */
export function pinDrop(gap: number): number {
  if (gap <= PIN_CLEARANCE_PX) return 1;
  return PIN_PREFLIGHT_DROP * clamp((PIN_CLEARANCE_PX + PIN_PREFLIGHT_PX - gap) / PIN_PREFLIGHT_PX, 0, 1);
}
