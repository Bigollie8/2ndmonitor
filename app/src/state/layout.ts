import { useEffect, useState } from 'react';

/** Stable id generator. Uses crypto.randomUUID when available, else falls back
 *  to a Math.random-based string (sufficient for instance ids that don't need
 *  cryptographic uniqueness). */
export function newId(): string {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `id_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export type TileType = 'discord' | 'spotify' | 'claude' | 'notes' | 'mixer' | 'sysmon' | 'clock' | 'viz' | 'streamDeck' | 'weatherRadar' | 'pomodoro';

/** Canonical render order for tile types. Used by tile-picker, layers panel,
 *  and the legacy → tiles-array migration. */
export const ALL_TILE_TYPES: TileType[] = [
  'viz', 'spotify', 'discord', 'claude', 'mixer', 'notes', 'sysmon', 'clock', 'streamDeck', 'weatherRadar', 'pomodoro',
];

export interface Rect { x: number; y: number; w: number; h: number }
export type Layout = Partial<Record<TileType, Rect>>;

/** Top chrome bar height in CSS pixels. Same value at any viewport. */
export const CHROME_TOP_PX = 56;
/** Bottom status bar height in CSS pixels. */
export const CHROME_BOTTOM_PX = 32;

/** Smallest usable tile in CSS pixels. Drives clamp on resize. */
export const MIN_SIZE_PX = { w: 200, h: 140 } as const;

/** Snap step expressed as fraction of canvas. 40/2560 ≈ 0.015625, preserving
 *  today's snap feel on a landscape monitor. */
export const SNAP_FRAC = 40 / 2560;

/** One orientation's full layout state — an ordered list of placed tile instances. */
export interface OrientationLayout {
  tiles: TileInstance[];
}

/** A single placed tile in a profile's layout. Multiple instances of the same
 *  type are allowed for tile types where `multiInstance: true` (currently none —
 *  Stream Deck in Phase 2b will be the first). Singleton types render at most
 *  one instance per profile/orientation. */
export interface TileInstance {
  /** Stable UUID. Survives across drag/resize/profile-switch/reload. */
  instanceId: string;
  /** Which kind of tile renders. */
  type: TileType;
  /** Position + size, fractional [0,1] coordinates. */
  rect: Rect;
  /** Tile-type-specific settings. Empty for singleton tiles today;
   *  Stream Deck will populate it with button definitions. */
  config?: Record<string, unknown>;
  /** Optional user-set name. Useful for disambiguating multiple instances
   *  of the same type. No UI sets/reads this in 2a. */
  name?: string;
}

const TOP = 56;
const BOTTOM = 32;
const SIDE = 20;
const GAP = 14;

const RAIL_W = 560;

const RAIL_ROWS: { id: TileType; weight: number }[] = [
  { id: 'discord', weight: 1.1 },
  { id: 'spotify', weight: 1.0 },
  { id: 'claude',  weight: 1.4 },
  { id: 'mixer',   weight: 0.9 },
  { id: 'notes',   weight: 0.6 },
];

const STRIP_H = 360;

const STRIP_COLS: { id: TileType; weight: number }[] = [
  { id: 'sysmon', weight: 1.4 },
  { id: 'clock',  weight: 2.0 },
];

// Fractional equivalents of the pixel constants above, used by the
// percent-based layout helpers.
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

export const DEFAULT_LANDSCAPE_LAYOUT: Record<TileType, Rect> = {
  ...(railRectsFrac() as Record<TileType, Rect>),
  ...(stripRectsFrac() as Record<TileType, Rect>),
  viz: VIZ_RECT_F,
  streamDeck: { x: 0.40, y: 0.55, w: 0.30, h: 0.18 },
  weatherRadar: { x: 0.42, y: 0.05, w: 0.30, h: 0.30 },
  pomodoro: { x: 0.05, y: 0.55, w: 0.20, h: 0.18 },
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
const P_NOTES_H = 0.045;

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

export const DEFAULT_PORTRAIT_LAYOUT: Record<TileType, Rect> = {
  viz: P_VIZ,
  spotify: P_SPOTIFY,
  discord: P_DISCORD,
  mixer: P_MIXER,
  claude: P_CLAUDE,
  sysmon: P_SYSMON,
  clock: P_CLOCK,
  notes: P_NOTES,
  streamDeck: { x: 0.05, y: 0.78, w: 0.90, h: 0.12 },
  weatherRadar: { x: 0.05, y: 0.30, w: 0.90, h: 0.20 },
  pomodoro: { x: 0.05, y: 0.62, w: 0.43, h: 0.10 },
};

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
 *  to the new orientation-aware shape using TileInstance arrays. Idempotent —
 *  if both orientations already have `tiles`, returns them unchanged. */
export function migrateLegacyProfileToOrientations<T extends {
  id: string; name: string; color: string;
  layout?: Layout;
  hidden?: Partial<Record<TileType, boolean>>;
  landscape?: { layout?: Layout; hidden?: Partial<Record<TileType, boolean>>; tiles?: TileInstance[] };
  portrait?: { layout?: Layout; hidden?: Partial<Record<TileType, boolean>>; tiles?: TileInstance[] };
}>(p: T): {
  id: string; name: string; color: string;
  landscape: OrientationLayout;
  portrait: OrientationLayout;
} {
  const slotToTiles = (
    slot: { layout?: Layout; hidden?: Partial<Record<TileType, boolean>>; tiles?: TileInstance[] } | undefined,
    defaults: Record<TileType, Rect>,
  ): TileInstance[] => {
    if (slot?.tiles) return slot.tiles;
    const layout = slot?.layout ?? {};
    const hidden = slot?.hidden ?? {};
    return migrateLayoutHiddenToTiles(layout, hidden, defaults);
  };

  if (p.landscape?.tiles && p.portrait?.tiles) {
    return {
      id: p.id, name: p.name, color: p.color,
      landscape: { tiles: p.landscape.tiles },
      portrait: { tiles: p.portrait.tiles },
    };
  }

  const legacyLayout = p.layout ?? {};
  const legacyHidden = p.hidden ?? {};
  const convertedTopLayout: Layout = {};
  for (const k of Object.keys(legacyLayout) as TileType[]) {
    const r = legacyLayout[k];
    if (r) convertedTopLayout[k] = legacyRectToFraction(r);
  }

  const landscapeSrc = p.landscape ?? { layout: convertedTopLayout, hidden: legacyHidden };
  const portraitSrc = p.portrait ?? { layout: {}, hidden: legacyHidden };

  return {
    id: p.id, name: p.name, color: p.color,
    landscape: { tiles: slotToTiles(landscapeSrc, DEFAULT_LANDSCAPE_LAYOUT) },
    portrait:  { tiles: slotToTiles(portraitSrc, DEFAULT_PORTRAIT_LAYOUT) },
  };
}

/** Find a snap-aligned, non-overlapping rect close to `preferred`. If `preferred`
 *  is already empty, returns it unchanged. Otherwise scans snap-aligned positions
 *  for an empty slot of the same size, scoring by Euclidean distance from
 *  `preferred` and returning the best. If no empty slot exists, returns
 *  `preferred` (overlap allowed as fallback; user can drag). */
export function findEmptyRect(
  visibleRects: Rect[],
  preferred: Rect,
  canvasPx: { w: number; h: number },
): Rect {
  const overlaps = (a: Rect, b: Rect) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const overlapsAny = (r: Rect) => visibleRects.some((v) => overlaps(r, v));

  if (!overlapsAny(preferred)) return preferred;

  const topF = CHROME_TOP_PX / canvasPx.h;
  const botF = CHROME_BOTTOM_PX / canvasPx.h;
  const xMax = 1 - preferred.w;
  const yMax = 1 - botF - preferred.h;

  let best: Rect | null = null;
  let bestScore = Infinity;

  for (let x = 0; x <= xMax + 1e-9; x += SNAP_FRAC) {
    for (let y = topF; y <= yMax + 1e-9; y += SNAP_FRAC) {
      const candidate: Rect = { x, y, w: preferred.w, h: preferred.h };
      if (overlapsAny(candidate)) continue;
      const dx = x - preferred.x;
      const dy = y - preferred.y;
      const score = dx * dx + dy * dy;
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
  }

  return best ?? preferred;
}

/** Find the first instance of a given type. For singleton types this is "the" instance. */
export function findInstance(tiles: TileInstance[], type: TileType): TileInstance | undefined {
  return tiles.find((t) => t.type === type);
}

/** Get an instance by id. */
export function getInstance(tiles: TileInstance[], instanceId: string): TileInstance | undefined {
  return tiles.find((t) => t.instanceId === instanceId);
}

/** Append an instance immutably. */
export function addInstance(tiles: TileInstance[], instance: TileInstance): TileInstance[] {
  return [...tiles, instance];
}

/** Remove an instance by id immutably. */
export function removeInstance(tiles: TileInstance[], instanceId: string): TileInstance[] {
  return tiles.filter((t) => t.instanceId !== instanceId);
}

/** Patch an instance immutably. Non-matching instances are returned by reference. */
export function updateInstance(
  tiles: TileInstance[],
  instanceId: string,
  patch: Partial<TileInstance>,
): TileInstance[] {
  return tiles.map((t) => (t.instanceId === instanceId ? { ...t, ...patch } : t));
}

/** Convert legacy {layout, hidden} shape to the new tiles array.
 *  Walks ALL_TILE_TYPES order. For each type:
 *    - if hidden[type] → skip
 *    - else create instance { instanceId: newId(), type, rect: layout[type] ?? defaults[type] }
 *
 *  Pure function; deterministic given the same inputs (other than the fresh
 *  instanceIds). Idempotency at the call-site level is the caller's concern. */
export function migrateLayoutHiddenToTiles(
  layout: Layout,
  hidden: Partial<Record<TileType, boolean>>,
  defaults: Record<TileType, Rect>,
): TileInstance[] {
  const out: TileInstance[] = [];
  for (const type of ALL_TILE_TYPES) {
    if (hidden[type]) continue;
    const rect = layout[type] ?? defaults[type];
    out.push({ instanceId: newId(), type, rect });
  }
  return out;
}
