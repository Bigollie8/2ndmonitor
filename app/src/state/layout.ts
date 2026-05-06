export type TileId = 'discord' | 'spotify' | 'claude' | 'notes' | 'mixer' | 'sysmon' | 'clock' | 'viz';
export interface Rect { x: number; y: number; w: number; h: number }
export type Layout = Partial<Record<TileId, Rect>>;

/** Top chrome bar height in CSS pixels. Same value at any viewport. */
export const CHROME_TOP_PX = 56;
/** Bottom status bar height in CSS pixels. */
export const CHROME_BOTTOM_PX = 32;

/** Smallest usable tile in CSS pixels. Drives clamp on resize. */
export const MIN_SIZE_PX = { w: 200, h: 140 } as const;

/** Snap step expressed as fraction of canvas. 40/2560 ≈ 0.015625, preserving
 *  today's snap feel on a landscape monitor. */
export const SNAP_FRAC = 40 / 2560;

/** One orientation's full layout state — tile rects (fractional) and visibility. */
export interface OrientationLayout {
  layout: Layout;
  hidden: Partial<Record<TileId, boolean>>;
}

const TOP = 56;
const BOTTOM = 32;
const SIDE = 20;
const GAP = 14;

const RAIL_X = SIDE;
const RAIL_W = 560;
const RAIL_Y = TOP + 8;
const RAIL_H = 1440 - TOP - BOTTOM - 16;

const RAIL_ROWS: { id: TileId; weight: number }[] = [
  { id: 'discord', weight: 1.1 },
  { id: 'spotify', weight: 1.0 },
  { id: 'claude',  weight: 1.4 },
  { id: 'mixer',   weight: 0.9 },
  { id: 'notes',   weight: 0.6 },
];

const RIGHT_X = RAIL_X + RAIL_W + GAP;
const RIGHT_W = 2560 - RIGHT_X - SIDE;
const STRIP_H = 360;

function railRects(): Record<string, Rect> {
  const sum = RAIL_ROWS.reduce((a, r) => a + r.weight, 0);
  const unit = (RAIL_H - GAP * (RAIL_ROWS.length - 1)) / sum;
  let y = RAIL_Y;
  const out: Record<string, Rect> = {};
  for (const r of RAIL_ROWS) {
    const h = r.weight * unit;
    out[r.id] = { x: RAIL_X, y, w: RAIL_W, h };
    y += h + GAP;
  }
  return out;
}

const VIZ_RECT: Rect = {
  x: RIGHT_X, y: RAIL_Y, w: RIGHT_W, h: RAIL_H - STRIP_H - GAP,
};
const STRIP_Y = VIZ_RECT.y + VIZ_RECT.h + GAP;

const STRIP_COLS: { id: TileId; weight: number }[] = [
  { id: 'sysmon', weight: 1.4 },
  { id: 'clock',  weight: 2.0 },
];

function stripRects(): Record<string, Rect> {
  const sum = STRIP_COLS.reduce((a, c) => a + c.weight, 0);
  const unit = (RIGHT_W - GAP * (STRIP_COLS.length - 1)) / sum;
  let x = RIGHT_X;
  const out: Record<string, Rect> = {};
  for (const c of STRIP_COLS) {
    const w = c.weight * unit;
    out[c.id] = { x, y: STRIP_Y, w, h: STRIP_H };
    x += w + GAP;
  }
  return out;
}

export const DEFAULT_LAYOUT: Record<TileId, Rect> = {
  ...(railRects() as Record<TileId, Rect>),
  ...(stripRects() as Record<TileId, Rect>),
  viz: VIZ_RECT,
};

export const CANVAS = { w: 2560, h: 1440, top: TOP, bottom: BOTTOM };
export const SNAP_PX = 40;
export const MIN_SIZE = { w: 200, h: 140 };

export function clampRect(r: Rect): Rect {
  const x = Math.max(0, Math.min(CANVAS.w - MIN_SIZE.w, Math.round(r.x)));
  const y = Math.max(CANVAS.top, Math.min(CANVAS.h - CANVAS.bottom - MIN_SIZE.h, Math.round(r.y)));
  const w = Math.max(MIN_SIZE.w, Math.min(CANVAS.w - x, Math.round(r.w)));
  const h = Math.max(MIN_SIZE.h, Math.min(CANVAS.h - CANVAS.bottom - y, Math.round(r.h)));
  return { x, y, w, h };
}

export function snap(v: number): number {
  return Math.round(v / SNAP_PX) * SNAP_PX;
}

/** Clamp a fractional rect against a live canvas size in CSS pixels. Enforces
 *  pixel-based minimums (so tiles don't shrink below content readability) and
 *  pixel-based chrome reserved areas (top/bottom bars). Returned rect is also
 *  fractional. */
export function clampRectFrac(r: Rect, canvasPx: { w: number; h: number }): Rect {
  const minW = MIN_SIZE_PX.w / canvasPx.w;
  const minH = MIN_SIZE_PX.h / canvasPx.h;
  const topF = CHROME_TOP_PX / canvasPx.h;
  const botF = CHROME_BOTTOM_PX / canvasPx.h;

  const x = Math.max(0, Math.min(1 - minW, r.x));
  const y = Math.max(topF, Math.min(1 - botF - minH, r.y));
  const w = Math.max(minW, Math.min(1 - x, r.w));
  const h = Math.max(minH, Math.min(1 - botF - y, r.h));
  return { x, y, w, h };
}

/** Snap a fractional value to `SNAP_FRAC` increments. */
export function snapFrac(v: number): number {
  return Math.round(v / SNAP_FRAC) * SNAP_FRAC;
}

/** One-shot conversion: legacy 2560x1440 px rect -> fractional rect. */
export function legacyRectToFraction(r: Rect): Rect {
  return {
    x: r.x / 2560,
    y: r.y / 1440,
    w: r.w / 2560,
    h: r.h / 1440,
  };
}
