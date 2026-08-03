// ─────────────────────────────────────────────────────────────────────────────
// How the catalog is ordered.
//
// Pure module — no React, no Tauri — so it is node-testable.
//
// This is what displaces `mergeCatalog`'s unconditional
// `.sort((a, b) => a.name.localeCompare(b.name))`: alphabetical is now one
// mode among six rather than the only possible answer.
// ─────────────────────────────────────────────────────────────────────────────
import type { CatalogItem } from './catalog';

export type SortMode = 'relevance' | 'installs' | 'rating' | 'newest' | 'updated' | 'name';

export const SORT_LABELS: Record<SortMode, string> = {
  relevance: 'Best match',
  installs: 'Most installed',
  rating: 'Top rated',
  newest: 'Newest',
  updated: 'Recently updated',
  name: 'A–Z',
};

/** Bundle-level dates, keyed by `CatalogItem.key`. Supplied by the caller
 *  (see state/catalogVersions.ts) rather than read off the item, because they
 *  are derived from the SET of an id's index rows, which a single item does
 *  not carry. */
export type DateMap = Map<string, { publishedAt: number | null; updatedAt: number | null }>;

const byName = (a: CatalogItem, b: CatalogItem) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/** Descending numeric compare where `null` always loses. Used for downloads,
 *  ratings and dates alike: "unknown" must sort last, never masquerade as a
 *  top result — an unrated bundle at the top of "Top rated" would be a lie. */
const descNullsLast = (x: number | null, y: number | null): number => {
  if (x == null && y == null) return 0;
  if (x == null) return 1;
  if (y == null) return -1;
  return y - x;
};

export function sortItems(items: CatalogItem[], mode: SortMode, dates?: DateMap): CatalogItem[] {
  // Relevance is identity: `searchItems` has already ordered by score, and
  // having two modules both claim the ordering decision is how they drift.
  if (mode === 'relevance') return [...items];

  const out = [...items];
  const cmp = (a: CatalogItem, b: CatalogItem): number => {
    switch (mode) {
      case 'installs':
        return descNullsLast(a.downloads, b.downloads) || byName(a, b);
      case 'rating':
        return descNullsLast(a.rating?.avg ?? null, b.rating?.avg ?? null) || byName(a, b);
      case 'newest':
        return descNullsLast(
          dates?.get(a.key)?.publishedAt ?? null,
          dates?.get(b.key)?.publishedAt ?? null,
        ) || byName(a, b);
      case 'updated':
        return descNullsLast(
          dates?.get(a.key)?.updatedAt ?? null,
          dates?.get(b.key)?.updatedAt ?? null,
        ) || byName(a, b);
      case 'name':
      default:
        return byName(a, b);
    }
  };
  return out.sort(cmp);
}
