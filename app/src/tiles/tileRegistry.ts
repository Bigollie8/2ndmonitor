// ─────────────────────────────────────────────────────────────────────────────
// Merges the compile-time tile table with tile bundles installed at runtime.
//
// TileType/TILE_META used to be a closed union + Record, which made an
// installed tile bundle unreachable from the Tile Library, edit mode, layout
// defaults, or Stream Deck actions — it had no slot in the catalog at all.
// This module opens the catalog: built-ins first (in `ALL_TILE_TYPES` order),
// then installed bundles as `bundle:<id>` tiles that behave like any other
// catalog entry. Same `bundle:` convention as `VizMode` / `contentRegistry.ts`.
//
// Pure module — no React, no Tauri — so it is node-testable. The caller owns
// reading folders off disk (the `tiles_list` Tauri command).
// ─────────────────────────────────────────────────────────────────────────────
import type { BuiltinTileType, TileType } from '../state/layout';
import { ALL_TILE_TYPES } from '../state/layout';
import type { TileMeta } from '../state/tileMeta';

/** A tile folder as reported by the `tiles_list` Tauri command. */
export interface InstalledTileFolder {
  id: string;
  name: string;
  author: string | null;
  version: string;
  api: number | null;
  manifest_error: string | null;
  /** "marketplace" when the folder carries an `installed.json` marker written
   *  by `marketplace_install`; "local" for a hand-authored draft. Only
   *  "marketplace" folders are merged into the catalog below — a locally
   *  dropped or invalid folder must not occupy a slot on the user's
   *  dashboard. */
  source: 'marketplace' | 'local';
}

export interface TileEntry {
  type: TileType;
  meta: TileMeta;
  source: 'builtin' | 'bundle';
  /** Set only when `source === 'bundle'`. */
  bundleId?: string;
}

export const BUNDLE_PREFIX = 'bundle:';

export const bundleTileId = (id: string): TileType => `${BUNDLE_PREFIX}${id}`;

/** Type guard (not just a boolean check) so a caller indexing a
 *  `Record<BuiltinTileType, …>` with a `TileType` value narrows to
 *  `BuiltinTileType` in the `else` branch without a cast. */
export function isBundleTile(type: string): type is `bundle:${string}` {
  return type.startsWith(BUNDLE_PREFIX);
}

export const bundleIdOf = (type: string): string | null =>
  isBundleTile(type) ? type.slice(BUNDLE_PREFIX.length) : null;

/** Icon shown for every installed bundle tile — a bundle has no author-chosen
 *  glyph, so all of them share this one. Also the icon a `TileType`-keyed
 *  consumer (e.g. the edit-mode layers panel) should fall back to for a
 *  `bundle:<id>` instance it doesn't have real metadata for. */
export const BUNDLE_TILE_ICON = '◰';

/** Built-ins in `ALL_TILE_TYPES` order, then installed bundles appended in
 *  whatever order they're given (callers sort the folder list themselves if
 *  they want a specific display order).
 *
 *  Folders are skipped when they failed manifest validation or declare an api
 *  this build does not implement — a broken folder must not become a
 *  selectable tile that renders nothing. They are also skipped when
 *  `source !== 'marketplace'` (see `InstalledTileFolder.source`), and when
 *  their id collides with a built-in — a bundle can never shadow a built-in
 *  tile.
 *
 *  A bundle's `TileMeta` is synthesized: `multiInstance: false` is deliberate
 *  for this phase (per-instance config exists but multi-instance placement is
 *  not yet designed), and `category: 'integrations'` groups every installed
 *  tile together in the Tile Library regardless of what it actually shows. */
export function mergeTileCatalog(
  builtin: Record<BuiltinTileType, TileMeta>,
  installed: InstalledTileFolder[],
): TileEntry[] {
  const builtinIds = new Set<string>(Object.keys(builtin));

  const builtinEntries: TileEntry[] = ALL_TILE_TYPES.map((type) => ({
    type,
    meta: builtin[type],
    source: 'builtin' as const,
  }));

  const bundleEntries: TileEntry[] = installed
    .filter((f) => f.source === 'marketplace' && f.manifest_error === null && f.api === 1 && !builtinIds.has(f.id))
    .map((f) => ({
      type: bundleTileId(f.id),
      meta: {
        icon: BUNDLE_TILE_ICON,
        label: f.name,
        description: f.author ? `by ${f.author}` : 'installed tile',
        multiInstance: false,
        category: 'integrations',
      },
      source: 'bundle' as const,
      bundleId: f.id,
    }));

  return [...builtinEntries, ...bundleEntries];
}
