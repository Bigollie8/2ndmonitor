// ─────────────────────────────────────────────────────────────────────────────
// Free-text search over the catalog, scored.
//
// Pure module — no React, no Tauri — so it is node-testable in isolation from
// the components that own the query state.
//
// Was a substring match over name and description. That was as good as the
// data allowed: before Market v2 a marketplace bundle's `description` was the
// synthesized string "by oli***", so searching it found essentially nothing.
// With real summaries, tags and authors in the index, the useful question is
// not "does it match" but "how well" — which is also what feeds the
// `relevance` sort mode (state/catalogSort.ts).
// ─────────────────────────────────────────────────────────────────────────────
import type { CatalogItem } from '../state/catalog';

/** Field weights, highest first. A name hit is worth more than a tag hit is
 *  worth more than prose, because that is the order in which a person
 *  recognises the thing they were looking for. */
const W_NAME_EXACT = 100;
const W_NAME_PREFIX = 60;
const W_NAME_SUBSTR = 40;
const W_TAG_EXACT = 30;
const W_TAG_SUBSTR = 18;
const W_SUMMARY = 12;
const W_AUTHOR = 8;
const W_DESCRIPTION = 4;

/** 0 means no match. Higher is a better match. */
export function scoreItem(item: CatalogItem, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;

  let score = 0;
  const name = item.name.toLowerCase();
  if (name === q) score += W_NAME_EXACT;
  else if (name.startsWith(q)) score += W_NAME_PREFIX;
  else if (name.includes(q)) score += W_NAME_SUBSTR;

  for (const tag of item.tags) {
    const t = tag.toLowerCase();
    if (t === q) score += W_TAG_EXACT;
    else if (t.includes(q)) score += W_TAG_SUBSTR;
  }

  if (item.summary?.toLowerCase().includes(q)) score += W_SUMMARY;
  if (item.authorDisplay?.toLowerCase().includes(q)) score += W_AUTHOR;
  if (item.description.toLowerCase().includes(q)) score += W_DESCRIPTION;

  return score;
}

/** Matching items, best first. A blank (or whitespace-only) query is
 *  identity IN THE INPUT ORDER — callers rely on that to render an unsearched
 *  catalog without special-casing "no query yet". */
export function searchItems(items: CatalogItem[], query: string): CatalogItem[] {
  const q = query.trim();
  if (!q) return items;
  return items
    .map((item) => ({ item, score: scoreItem(item, q) }))
    .filter((r) => r.score > 0)
    // Ties break on name so a search result list is stable between renders.
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name))
    .map((r) => r.item);
}
