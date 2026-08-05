// ─────────────────────────────────────────────────────────────────────────────
// The "new from creators you follow" shelf.
//
// Pure module — no React, no Tauri — so the resolution rules are
// node-testable.
//
// The server sends bundle IDS only (newest first); the client already holds
// the whole catalog and resolves them itself, so bundle data never travels
// twice. This module is that resolution: order preserved, duplicates and
// unknowns dropped, removed items excluded — a tombstoned bundle must not
// sneak back in through the feed.
// ─────────────────────────────────────────────────────────────────────────────
import type { CatalogItem } from './catalog';
import type { Shelf } from './catalogShelves';
import { EMPTY_FACETS } from './catalogFilter';

/** Same cap every other shelf has (see catalogShelves.SHELF_MAX). */
export const FEED_SHELF_MAX = 12;

/** Feed ids → catalog items, in the server's (newest-first) order. */
export function resolveFeed(ids: string[], items: CatalogItem[]): CatalogItem[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const seen = new Set<string>();
  const out: CatalogItem[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const item = byId.get(id);
    if (item && !item.removed) out.push(item);
  }
  return out;
}

/** The shelf itself, or `null` when there is nothing to show — an empty
 *  personal shelf would read as "the people you follow made nothing", which
 *  is a worse message than no shelf. Exempt from SHELF_MIN for the same
 *  reason the Updates shelf is: one new thing from someone you chose to
 *  follow is worth a row. */
export function feedShelf(ids: string[], items: CatalogItem[]): Shelf | null {
  const resolved = resolveFeed(ids, items).slice(0, FEED_SHELF_MAX);
  if (resolved.length === 0) return null;
  return {
    id: 'feed',
    title: 'New from creators you follow',
    items: resolved,
    facets: { ...EMPTY_FACETS },
    sort: 'newest',
  };
}
