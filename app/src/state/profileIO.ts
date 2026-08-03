// ─────────────────────────────────────────────────────────────────────────────
// Profile export/import file format (0.7.1 §3). Pure module — no React, no
// Tauri — node-tested. The switcher UI (components/profile.tsx) owns the
// dialogs; this module owns the shape.
//
// Privacy rule: `config.mapView` is a saved map center — the user's home
// location — and profile files are meant to be shared. It is stripped on
// export AND (defensively) on import.
// ─────────────────────────────────────────────────────────────────────────────
import type { Profile } from '../types';
import type { OrientationLayout, Rect, TileInstance } from './layout';
import { clampRectFrac, newId } from './layout';

export const PROFILE_EXPORT_KIND = '2ndmonitor-profile';
export const PROFILE_EXPORT_VERSION = 1;

export interface ProfileExportFile {
  kind: typeof PROFILE_EXPORT_KIND;
  version: typeof PROFILE_EXPORT_VERSION;
  name: string;
  color: string;
  landscape: { tiles: TileInstance[] };
  portrait: { tiles: TileInstance[] };
}

export interface ParsedProfile {
  name: string;
  color: string;
  landscape: OrientationLayout;
  portrait: OrientationLayout;
}

export type ParseProfileResult =
  | { ok: true; profile: ParsedProfile }
  | { ok: false; error: string };

/** Rects are fractional; clampRectFrac wants a pixel canvas for its minimum
 *  sizes. Use the app's reference resolution (same constants that define
 *  SNAP_FRAC and the legacy px→fraction conversion in layout.ts). */
const REF_CANVAS = { w: 2560, h: 1440 };

const FALLBACK_COLOR = '#a78bfa';

/** Drop `mapView`; return undefined when nothing else remains. */
function stripMapView(config: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!config) return undefined;
  const { mapView: _mapView, ...rest } = config;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

export function buildProfileExport(profile: Profile): ProfileExportFile {
  const exportTiles = (tiles: TileInstance[]): TileInstance[] =>
    tiles.map((t) => {
      const out: TileInstance = { instanceId: t.instanceId, type: t.type, rect: { ...t.rect } };
      if (t.name !== undefined) out.name = t.name;
      const config = stripMapView(t.config);
      if (config !== undefined) out.config = config;
      return out;
    });
  return {
    kind: PROFILE_EXPORT_KIND,
    version: PROFILE_EXPORT_VERSION,
    name: profile.name,
    color: profile.color,
    landscape: { tiles: exportTiles(profile.landscape.tiles) },
    portrait: { tiles: exportTiles(profile.portrait.tiles) },
  };
}

const isFiniteNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** One tile from an untrusted file → a safe TileInstance, or null if
 *  malformed. Fresh instanceId ALWAYS (imported ids must never collide);
 *  rect clamped; mapView stripped; unknown `type` strings pass through —
 *  renderTile's default case shows MissingTileCard for them, same as today. */
function parseTile(raw: unknown): TileInstance | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const t = raw as Record<string, unknown>;
  if (typeof t.type !== 'string' || t.type === '') return null;
  const r = t.rect;
  if (!r || typeof r !== 'object') return null;
  const rr = r as Record<string, unknown>;
  if (!isFiniteNum(rr.x) || !isFiniteNum(rr.y) || !isFiniteNum(rr.w) || !isFiniteNum(rr.h)) return null;
  const rect: Rect = clampRectFrac({ x: rr.x, y: rr.y, w: rr.w, h: rr.h }, REF_CANVAS);
  const out: TileInstance = { instanceId: newId(), type: t.type as TileInstance['type'], rect };
  if (typeof t.name === 'string') out.name = t.name;
  if (t.config && typeof t.config === 'object' && !Array.isArray(t.config)) {
    const config = stripMapView(t.config as Record<string, unknown>);
    if (config !== undefined) out.config = config;
  }
  return out;
}

function parseOrientation(raw: unknown, which: string): OrientationLayout | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: `Missing ${which} layout.` };
  const tilesRaw = (raw as { tiles?: unknown }).tiles;
  if (!Array.isArray(tilesRaw)) return { error: `Missing ${which} tile list.` };
  const tiles: TileInstance[] = [];
  for (let i = 0; i < tilesRaw.length; i++) {
    const tile = parseTile(tilesRaw[i]);
    if (tile === null) return { error: `Malformed tile #${i + 1} in the ${which} layout.` };
    tiles.push(tile);
  }
  return { tiles };
}

export function parseProfileExport(raw: unknown): ParseProfileResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Not a profile file.' };
  }
  const f = raw as Record<string, unknown>;
  if (f.kind !== PROFILE_EXPORT_KIND) {
    return { ok: false, error: 'Not a 2ndmonitor profile file.' };
  }
  if (f.version !== PROFILE_EXPORT_VERSION) {
    return { ok: false, error: `Unsupported profile file version (${String(f.version)}).` };
  }
  if (typeof f.name !== 'string' || f.name.trim() === '') {
    return { ok: false, error: 'Profile file has no name.' };
  }
  const color = typeof f.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(f.color)
    ? f.color
    : FALLBACK_COLOR;
  const landscape = parseOrientation(f.landscape, 'landscape');
  if ('error' in landscape) return { ok: false, error: landscape.error };
  const portrait = parseOrientation(f.portrait, 'portrait');
  if ('error' in portrait) return { ok: false, error: portrait.error };
  return { ok: true, profile: { name: f.name.trim(), color, landscape, portrait } };
}

/** Default save-dialog filename per spec: `<profile-name>.2ndmonitor-profile.json`,
 *  with Windows-forbidden filename characters removed. */
export function exportFileName(profileName: string): string {
  const safe = profileName.replace(/[\\/:*?"<>|]/g, '').trim() || 'profile';
  return `${safe}.2ndmonitor-profile.json`;
}
