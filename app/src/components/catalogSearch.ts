// ─────────────────────────────────────────────────────────────────────────────
// Free-text search over the catalog. Pure module — no React, no Tauri — so
// it's node-testable in isolation from ContentLibrary, which owns the query
// state and the "search all content" affordance built on top of this.
// ─────────────────────────────────────────────────────────────────────────────
import type { CatalogItem } from '../state/catalog';

/** Case-insensitive substring match over name and description. A blank (or
 *  whitespace-only) query is identity — the caller doesn't need to special-
 *  case "no query yet" before calling this. */
export function searchItems(items: CatalogItem[], query: string): CatalogItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter(
    (i) => i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q),
  );
}
