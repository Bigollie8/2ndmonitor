// ─────────────────────────────────────────────────────────────────────────────
// Which preview assets a detail view can show for one item.
//
// Pure module — no React, no Tauri — so it is node-testable.
//
// Two sources, one address space: `bundle_media` rows (Market v2) and the
// legacy `bundles.preview` blob that every bundle published before it
// carries. The server aliases `/preview` to media index 0, so a legacy blob
// and a first media row are both "index 0" and this module does not need to
// know which one it is looking at.
// ─────────────────────────────────────────────────────────────────────────────
import type { CatalogItem } from './catalog';

/** Mirrors the server's per-version cap (server/src/media.rs). Clamping here
 *  means a server that somehow reports more never makes the thumb strip
 *  render indexes that 404. */
const MAX_ASSETS = 6;

export interface MediaRef {
  idx: number;
  isHero: boolean;
}

export function mediaRefsFor(item: CatalogItem): MediaRef[] {
  // A first-party built-in is never published, so it has no (id, version) on
  // the server to fetch anything from — its card and detail view use the
  // TILE_META glyph instead.
  if (item.source === 'first-party') return [];
  if (!item.hasPreview) return [];

  const count = Math.min(Math.max(item.mediaCount, 1), MAX_ASSETS);
  return Array.from({ length: count }, (_, idx) => ({ idx, isHero: idx === 0 }));
}

/** More than one asset — i.e. worth rendering a thumbnail strip for. */
export function hasGallery(item: CatalogItem): boolean {
  return mediaRefsFor(item).length > 1;
}
