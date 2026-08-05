// ─────────────────────────────────────────────────────────────────────────────
// Turning one of your layouts into something publishable.
//
// Pure module — no React, no Tauri — so the one decision that must never be
// wrong is node-testable in isolation.
//
// THE ALLOWLIST IS THE WHOLE SAFETY STORY. A dashboard layout contains
// personal data: not secrets (those live in the encrypted store) but
// identifying config — the weather and radar tiles hold home coordinates,
// tile-githubprs a username, tile-stocks tickers, tile-birds a lat/lon. If
// publishing serialised `tile.config`, the first person to share a dashboard
// would publish their home address to a public marketplace.
//
// So this names the fields that MAY be published and copies nothing else.
// A field added to TileInstance or to the tweaks in some later release is
// private by default, because it was never named here. A denylist has the
// exact opposite failure mode, and that is the one that ships an incident.
// ─────────────────────────────────────────────────────────────────────────────
import type { Rect, TileInstance, TileType } from './layout';

/** A published tile: what it is and where it sits. No config, ever. */
export interface PublishedTile {
  type: TileType;
  rect: Rect;
}

/** The presentational tweaks a layout carries. Deliberately a closed set of
 *  scalars — no URLs, no file paths, no free text — so nothing here can
 *  smuggle a value that identifies a person or a machine. */
export interface PublishedTheme {
  accent: string;
  accent2: string;
  density: string;
  glass: boolean;
  vizMode: string;
}

export interface PublishedLayout {
  /** Schema version, so a future reader can refuse what it cannot understand
   *  rather than silently mis-reading it. */
  v: 1;
  landscape: PublishedTile[];
  portrait: PublishedTile[];
  theme: PublishedTheme;
}

/** Everything the serialiser is allowed to look at. Taking a narrow argument
 *  rather than the whole tweak state is itself part of the defence: this
 *  module cannot leak a field it was never handed. */
export interface PublishSource {
  landscape: TileInstance[];
  portrait: TileInstance[];
  accent: string;
  accent2: string;
  density: string;
  glass: boolean;
  vizMode: string;
}

/** Rounded to the nearest 0.0001. Raw floats carry more precision than a
 *  layout needs and make two visually identical layouts differ byte-wise,
 *  which would defeat de-duplication and make diffs noisy. */
const round = (n: number): number => Math.round(n * 10000) / 10000;

/** Clamped into the unit square. A rect outside it would render off-screen on
 *  the installer's machine even though it looked fine on the author's. */
const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

function publishTile(t: TileInstance): PublishedTile {
  // Field-by-field, never a spread. `{...t}` would carry `config`, `name`,
  // `instanceId` and anything added to TileInstance later — which is exactly
  // the leak this module exists to prevent.
  return {
    type: t.type,
    rect: {
      x: round(clamp01(t.rect.x)),
      y: round(clamp01(t.rect.y)),
      w: round(clamp01(t.rect.w)),
      h: round(clamp01(t.rect.h)),
    },
  };
}

export function toPublishedLayout(src: PublishSource): PublishedLayout {
  return {
    v: 1,
    landscape: src.landscape.map(publishTile),
    portrait: src.portrait.map(publishTile),
    theme: {
      accent: src.accent,
      accent2: src.accent2,
      density: src.density,
      glass: src.glass,
      vizMode: src.vizMode,
    },
  };
}

/** Bundle ids a published layout depends on, deduplicated.
 *
 *  A tile type is either a built-in (`weatherRadar`) or a marketplace bundle
 *  (`bundle:tile-quote`). Only the latter has anything to install, so only
 *  those appear here — see `layoutInstall.ts` for what happens to them. */
export function layoutDependencies(layout: PublishedLayout): string[] {
  const ids = new Set<string>();
  for (const t of [...layout.landscape, ...layout.portrait]) {
    const type = String(t.type);
    if (type.startsWith('bundle:')) ids.add(type.slice('bundle:'.length));
  }
  return [...ids].sort();
}

/** Does this object look like something we can read? Used on the install side
 *  before touching any field, so a malformed or future-versioned payload
 *  fails loudly at the boundary instead of half-applying. */
export function isPublishedLayout(value: unknown): value is PublishedLayout {
  if (value == null || typeof value !== 'object') return false;
  const l = value as Partial<PublishedLayout>;
  if (l.v !== 1) return false;
  if (!Array.isArray(l.landscape) || !Array.isArray(l.portrait)) return false;
  const okTile = (t: unknown): boolean => {
    if (t == null || typeof t !== 'object') return false;
    const pt = t as Partial<PublishedTile>;
    if (typeof pt.type !== 'string' || pt.type.length === 0) return false;
    const r = pt.rect;
    if (r == null || typeof r !== 'object') return false;
    return (['x', 'y', 'w', 'h'] as const).every((k) => {
      const v = (r as unknown as Record<string, unknown>)[k];
      return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
    });
  };
  return l.landscape.every(okTile) && l.portrait.every(okTile);
}
