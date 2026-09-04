// ─────────────────────────────────────────────────────────────────────────────
// Profile export/import file format (0.7.1 §3). Pure module — no React, no
// Tauri — node-tested. The switcher UI (components/profile.tsx) owns the
// dialogs; this module owns the shape.
//
// Privacy rule: `config.mapView` is a saved map center — the user's home
// location — and profile files are meant to be shared. It is stripped on
// export AND (defensively) on import. Since 0.9.17, new exports include only
// allowlisted presentation config; arbitrary tile/bundle config stays local.
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

/** Hard cap on tiles per orientation in an imported file. Defense-in-depth
 *  against a crafted file forcing the parser to materialize an unbounded
 *  array — no legitimate profile needs anywhere near this many tiles. */
const MAX_TILES_PER_ORIENTATION = 200;

/** Own-property keys that must never survive into a tile's `config`, so a
 *  future unsafe merge (e.g. `for (const k in config) target[k] = ...`) can
 *  never be tricked into rewriting an object's prototype. `mapView` is
 *  dropped for privacy (see file header); the other three are dropped for
 *  safety regardless of what they contain. */
const DANGEROUS_CONFIG_KEYS = new Set(['mapView', '__proto__', 'constructor', 'prototype']);

/** Drop `mapView` and any prototype-pollution-shaped keys; return undefined
 *  when nothing else remains. */
function sanitizeConfig(config: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!config) return undefined;
  const rest: Record<string, unknown> = {};
  for (const key of Object.keys(config)) {
    if (DANGEROUS_CONFIG_KEYS.has(key)) continue;
    rest[key] = config[key];
  }
  return Object.keys(rest).length > 0 ? rest : undefined;
}

/** Shared files carry presentation settings only. Bundle config has no trusted
 * schema here and may contain credentials, so none of it is exported. */
function shareableConfig(tile: TileInstance): Record<string, unknown> | undefined {
  if (tile.type.startsWith('bundle:') || !tile.config) return undefined;
  const safe: Record<string, unknown> = {};
  const layers = tile.config.layers;
  if (Array.isArray(layers)) safe.layers = layers.filter(x => typeof x === 'string' && ['rain', 'clouds', 'wind', 'temperature', 'pressure', 'radar', 'satellite'].includes(x));
  for (const key of ['opacity', 'speed', 'trailLength']) {
    const value = tile.config[key];
    if (typeof value === 'number' && Number.isFinite(value)) safe[key] = value;
  }
  return Object.keys(safe).length ? safe : undefined;
}

export function buildProfileExport(profile: Profile): ProfileExportFile {
  const exportTiles = (tiles: TileInstance[]): TileInstance[] =>
    tiles.map((t) => {
      const out: TileInstance = { instanceId: t.instanceId, type: t.type, rect: { ...t.rect } };
      if (t.name !== undefined) out.name = t.name;
      const config = shareableConfig(t);
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
    const config = sanitizeConfig(t.config as Record<string, unknown>);
    if (config !== undefined) out.config = config;
  }
  return out;
}

function parseOrientation(raw: unknown, which: string): OrientationLayout | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: `Missing ${which} layout.` };
  const tilesRaw = (raw as { tiles?: unknown }).tiles;
  if (!Array.isArray(tilesRaw)) return { error: `Missing ${which} tile list.` };
  if (tilesRaw.length > MAX_TILES_PER_ORIENTATION) {
    return { error: `Too many tiles in the ${which} layout (max ${MAX_TILES_PER_ORIENTATION}).` };
  }
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
  // eslint-disable-next-line no-control-regex -- deliberately stripping ASCII control chars from a filename
  const safe = profileName.replace(/[\\/:*?"<>|\x00-\x1F]/g, '').trim() || 'profile';
  return `${safe}.2ndmonitor-profile.json`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Partial SETUP export/import (0.9.8) — "share setups, not whole profiles".
//
// A setup file carries a tile list for ONE orientation (a user-picked subset
// or the whole arrangement) under its own `kind`, so the two formats can
// never be confused: parseProfileExport rejects setup files and vice versa.
// Import MERGES into the current profile's orientation instead of replacing
// anything. Same safeguards as the profile format, via the same helpers:
// fresh instanceIds, mapView + prototype keys stripped, tile cap, rect
// clamping.
// ─────────────────────────────────────────────────────────────────────────────

export const SETUP_EXPORT_KIND = '2ndmonitor-setup';
export const SETUP_EXPORT_VERSION = 1;

export interface SetupExportFile {
  kind: typeof SETUP_EXPORT_KIND;
  version: typeof SETUP_EXPORT_VERSION;
  name: string;
  /** Which orientation the rects were designed for. Import into the other
   *  orientation still works — rects are fractional — it just may need a
   *  tidy-up, so the UI shows this label. */
  orientation: 'landscape' | 'portrait';
  tiles: TileInstance[];
}

export type ParseSetupResult =
  | { ok: true; setup: { name: string; orientation: 'landscape' | 'portrait'; tiles: TileInstance[] } }
  | { ok: false; error: string };

export function buildSetupExport(
  name: string,
  orientation: 'landscape' | 'portrait',
  tiles: TileInstance[],
): SetupExportFile {
  return {
    kind: SETUP_EXPORT_KIND,
    version: SETUP_EXPORT_VERSION,
    name: name.trim() || 'setup',
    orientation,
    tiles: tiles.map((t) => {
      const out: TileInstance = { instanceId: t.instanceId, type: t.type, rect: { ...t.rect } };
      if (t.name !== undefined) out.name = t.name;
      const config = shareableConfig(t);
      if (config !== undefined) out.config = config;
      return out;
    }),
  };
}

export function parseSetupExport(raw: unknown): ParseSetupResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Not a setup file.' };
  }
  const f = raw as Record<string, unknown>;
  if (f.kind !== SETUP_EXPORT_KIND) {
    return { ok: false, error: 'Not a 2ndmonitor setup file.' };
  }
  if (f.version !== SETUP_EXPORT_VERSION) {
    return { ok: false, error: `Unsupported setup file version (${String(f.version)}).` };
  }
  const orientation = f.orientation === 'portrait' ? 'portrait' : f.orientation === 'landscape' ? 'landscape' : null;
  if (!orientation) return { ok: false, error: 'Setup file has no orientation.' };
  const parsed = parseOrientation({ tiles: f.tiles }, 'setup');
  if ('error' in parsed) return { ok: false, error: parsed.error };
  if (parsed.tiles.length === 0) return { ok: false, error: 'Setup file contains no tiles.' };
  const name = typeof f.name === 'string' && f.name.trim() !== '' ? f.name.trim() : 'Imported setup';
  return { ok: true, setup: { name, orientation, tiles: parsed.tiles } };
}

/** Merge imported setup tiles into an existing tile list. Additive only —
 *  nothing existing is removed or moved; the cap applies to the RESULT so a
 *  merge can't blow past the same limit imports honor. Returns the merged
 *  list plus how many tiles were dropped to stay under the cap. */
export function mergeSetupTiles(
  existing: TileInstance[],
  imported: TileInstance[],
): { tiles: TileInstance[]; dropped: number } {
  const room = Math.max(0, MAX_TILES_PER_ORIENTATION - existing.length);
  const take = imported.slice(0, room);
  return { tiles: [...existing, ...take], dropped: imported.length - take.length };
}

export function setupExportFileName(setupName: string): string {
  // eslint-disable-next-line no-control-regex -- deliberately stripping ASCII control chars from a filename
  const safe = setupName.replace(/[\\/:*?"<>|\x00-\x1F]/g, '').trim() || 'setup';
  return `${safe}.2ndmonitor-setup.json`;
}
