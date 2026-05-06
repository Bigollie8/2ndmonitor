import { useEffect, useState } from 'react';

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

// Fractional equivalents of the pixel constants above. Used by the new
// percent-based layout. The pixel constants stay during transition; they get
// removed when the legacy DEFAULT_LAYOUT is dropped in Task 8.
const TOP_F = TOP / 1440;
const BOTTOM_F = BOTTOM / 1440;
const SIDE_F_X = SIDE / 2560;
const GAP_F_X = GAP / 2560;
const GAP_F_Y = GAP / 1440;

const RAIL_X_F = SIDE_F_X;
const RAIL_W_F = RAIL_W / 2560;
const RAIL_Y_F = TOP_F + 8 / 1440;
const RAIL_H_F = 1 - TOP_F - BOTTOM_F - 16 / 1440;

const RIGHT_X_F = RAIL_X_F + RAIL_W_F + GAP_F_X;
const RIGHT_W_F = 1 - RIGHT_X_F - SIDE_F_X;
const STRIP_H_F = STRIP_H / 1440;

function railRectsFrac(): Record<string, Rect> {
  const sum = RAIL_ROWS.reduce((a, r) => a + r.weight, 0);
  const unit = (RAIL_H_F - GAP_F_Y * (RAIL_ROWS.length - 1)) / sum;
  let y = RAIL_Y_F;
  const out: Record<string, Rect> = {};
  for (const r of RAIL_ROWS) {
    const h = r.weight * unit;
    out[r.id] = { x: RAIL_X_F, y, w: RAIL_W_F, h };
    y += h + GAP_F_Y;
  }
  return out;
}

const VIZ_RECT_F: Rect = {
  x: RIGHT_X_F,
  y: RAIL_Y_F,
  w: RIGHT_W_F,
  h: RAIL_H_F - STRIP_H_F - GAP_F_Y,
};
const STRIP_Y_F = VIZ_RECT_F.y + VIZ_RECT_F.h + GAP_F_Y;

function stripRectsFrac(): Record<string, Rect> {
  const sum = STRIP_COLS.reduce((a, c) => a + c.weight, 0);
  const unit = (RIGHT_W_F - GAP_F_X * (STRIP_COLS.length - 1)) / sum;
  let x = RIGHT_X_F;
  const out: Record<string, Rect> = {};
  for (const c of STRIP_COLS) {
    const w = c.weight * unit;
    out[c.id] = { x, y: STRIP_Y_F, w, h: STRIP_H_F };
    x += w + GAP_F_X;
  }
  return out;
}

export const DEFAULT_LANDSCAPE_LAYOUT: Record<TileId, Rect> = {
  ...(railRectsFrac() as Record<TileId, Rect>),
  ...(stripRectsFrac() as Record<TileId, Rect>),
  viz: VIZ_RECT_F,
};

// Portrait template. Single column from top to bottom: viz dominates, then
// now-playing, two 2-up rows for related tiles, claude, sysmon+clock, notes.
// Heights chosen so the column sums to 1 minus chrome reserved areas.
const P_SIDE = 14 / 1080;       // ~14px on 1080w portrait
const P_GAP = 10 / 1080;        // tighter gap on portrait
const P_TOP = TOP_F;            // share top chrome height with landscape
const P_BOTTOM = BOTTOM_F;
const P_LEFT = P_SIDE;
const P_FULL_W = 1 - 2 * P_SIDE;
const P_HALF_W = (P_FULL_W - P_GAP) / 2;

// Row heights (fractions of canvas height). Tuned for ~1080x1920.
const P_VIZ_H = 0.40;
const P_NOWP_H = 0.10;
const P_2UP1_H = 0.12;          // discord + mixer
const P_CLAUDE_H = 0.11;
const P_2UP2_H = 0.11;          // sysmon + clock
const P_NOTES_H = 0.06;

let py = P_TOP + 8 / 1920;

const P_VIZ: Rect = { x: P_LEFT, y: py, w: P_FULL_W, h: P_VIZ_H };
py += P_VIZ_H + P_GAP;

const P_SPOTIFY: Rect = { x: P_LEFT, y: py, w: P_FULL_W, h: P_NOWP_H };
py += P_NOWP_H + P_GAP;

const P_DISCORD: Rect = { x: P_LEFT, y: py, w: P_HALF_W, h: P_2UP1_H };
const P_MIXER: Rect   = { x: P_LEFT + P_HALF_W + P_GAP, y: py, w: P_HALF_W, h: P_2UP1_H };
py += P_2UP1_H + P_GAP;

const P_CLAUDE: Rect = { x: P_LEFT, y: py, w: P_FULL_W, h: P_CLAUDE_H };
py += P_CLAUDE_H + P_GAP;

const P_SYSMON: Rect = { x: P_LEFT, y: py, w: P_HALF_W, h: P_2UP2_H };
const P_CLOCK: Rect  = { x: P_LEFT + P_HALF_W + P_GAP, y: py, w: P_HALF_W, h: P_2UP2_H };
py += P_2UP2_H + P_GAP;

const P_NOTES: Rect = { x: P_LEFT, y: py, w: P_FULL_W, h: P_NOTES_H };

export const DEFAULT_PORTRAIT_LAYOUT: Record<TileId, Rect> = {
  viz: P_VIZ,
  spotify: P_SPOTIFY,
  discord: P_DISCORD,
  mixer: P_MIXER,
  claude: P_CLAUDE,
  sysmon: P_SYSMON,
  clock: P_CLOCK,
  notes: P_NOTES,
};

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

/** 'landscape' when canvas is at least as wide as tall (with hysteresis when
 *  switching). 'portrait' otherwise. */
export type Orientation = 'landscape' | 'portrait';

/** Pure decision used by `useOrientation`. Exported for testability.
 *  - aspect ≤ 0.95: portrait
 *  - aspect ≥ 1.05: landscape
 *  - between: hold the previous value (or default to landscape on first call) */
export function decideOrientation(
  size: { w: number; h: number },
  prev: Orientation | undefined,
): Orientation {
  const aspect = size.w / size.h;
  if (aspect <= 0.95) return 'portrait';
  if (aspect >= 1.05) return 'landscape';
  return prev ?? 'landscape';
}

/** Live viewport size in CSS pixels. Re-renders on window resize. */
export function useCanvas(): { w: number; h: number } {
  const [size, setSize] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 2560,
    h: typeof window !== 'undefined' ? window.innerHeight : 1440,
  }));
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}

/** Returns the current orientation, applying hysteresis as the viewport changes. */
export function useOrientation(): Orientation {
  const canvas = useCanvas();
  const [orientation, setOrientation] = useState<Orientation>(() =>
    decideOrientation(canvas, undefined),
  );
  useEffect(() => {
    setOrientation((prev) => decideOrientation(canvas, prev));
  }, [canvas.w, canvas.h]);
  return orientation;
}

/** Convert a legacy profile shape (top-level `layout`/`hidden` in 2560x1440 px)
 *  to the new orientation-aware shape, preserving custom layouts on landscape
 *  and seeding portrait from the default. Idempotent — if `landscape`/`portrait`
 *  are already present, returns the input unchanged. */
export function migrateLegacyProfileToOrientations<T extends {
  id: string; name: string; color: string;
  layout?: Layout;
  hidden?: Partial<Record<TileId, boolean>>;
  landscape?: OrientationLayout;
  portrait?: OrientationLayout;
}>(p: T): {
  id: string; name: string; color: string;
  landscape: OrientationLayout;
  portrait: OrientationLayout;
} {
  if (p.landscape && p.portrait) {
    return {
      id: p.id, name: p.name, color: p.color,
      landscape: p.landscape, portrait: p.portrait,
    };
  }
  const legacyLayout = p.layout ?? {};
  const legacyHidden = p.hidden ?? {};
  const convertedLayout: Layout = {};
  for (const k of Object.keys(legacyLayout) as TileId[]) {
    const r = legacyLayout[k];
    if (r) convertedLayout[k] = legacyRectToFraction(r);
  }
  return {
    id: p.id, name: p.name, color: p.color,
    landscape: { layout: convertedLayout, hidden: legacyHidden },
    portrait: { layout: { ...DEFAULT_PORTRAIT_LAYOUT }, hidden: { ...legacyHidden } },
  };
}
