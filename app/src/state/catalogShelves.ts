// ─────────────────────────────────────────────────────────────────────────────
// The Discover home: ordered shelves over the merged catalog.
//
// Pure module — no React, no Tauri, and NO CLOCK: `nowSec` is injected, which
// is what makes "new this month" testable at all.
//
// Every shelf declares the `{facets, sort}` its "see all" navigates to, so a
// shelf and the grid it links into cannot disagree about what they contain —
// the grid re-derives its contents from the same two values.
// ─────────────────────────────────────────────────────────────────────────────
import type { CatalogItem } from './catalog';
import { EMPTY_FACETS, filterItems, type Facets } from './catalogFilter';
import { sortItems, type DateMap, type SortMode } from './catalogSort';

/** Below this many items a shelf suppresses itself. With 37 bundles the
 *  Featured / New / Most-installed sets overlap heavily, and a shelf holding
 *  one card reads as a bug rather than a recommendation. */
export const SHELF_MIN = 3;
/** Cards per shelf. Beyond this the row is a scroll chore, and "see all"
 *  exists for exactly that. */
export const SHELF_MAX = 12;

const NEW_WINDOW_SEC = 60 * 60 * 24 * 30;

export interface Shelf {
  id: string;
  title: string;
  items: CatalogItem[];
  /** What "see all" selects. */
  facets: Facets;
  sort: SortMode;
}

/** One curated set, as `GET /collections` reports it. `items` is an ordered
 *  list of bare bundle ids (no kind prefix) — the server has no notion of
 *  tile-vs-visualizer, same as the ratings endpoint. */
export interface Collection {
  slug: string;
  title: string;
  blurb: string | null;
  items: string[];
}

export function buildShelves(args: {
  items: CatalogItem[];
  collections: Collection[];
  dates: DateMap;
  nowSec: number;
  appVersion: string;
}): Shelf[] {
  const { items, collections, dates, nowSec, appVersion } = args;
  const shelves: Shelf[] = [];
  // Dedupe in DISPLAY order: the first shelf that can claim a bundle keeps
  // it, and later shelves see what is left. Without this, Featured / New /
  // Most-installed would show the same four cards three times over.
  const claimed = new Set<string>();

  const add = (
    id: string,
    title: string,
    pool: CatalogItem[],
    facets: Facets,
    sort: SortMode,
    opts: { minCount?: number; preserveOrder?: boolean } = {},
  ) => {
    const fresh = pool.filter((i) => !claimed.has(i.key)).slice(0, SHELF_MAX);
    if (fresh.length < (opts.minCount ?? SHELF_MIN)) return;
    for (const i of fresh) claimed.add(i.key);
    shelves.push({ id, title, items: fresh, facets, sort });
  };

  const visible = filterItems(items, EMPTY_FACETS, appVersion);

  // Pending updates lead, and are exempt from SHELF_MIN: one update worth
  // installing is worth saying so, where one featured bundle is not.
  add(
    'updates',
    'Updates ready',
    sortItems(filterItems(items, { ...EMPTY_FACETS, updates: true }, appVersion), 'name'),
    { ...EMPTY_FACETS, updates: true },
    'name',
    { minCount: 1 },
  );

  add(
    'featured',
    'Featured',
    sortItems(visible.filter((i) => i.featured), 'installs', dates),
    { ...EMPTY_FACETS },
    'installs',
  );

  add(
    'new',
    'New this month',
    sortItems(
      visible.filter((i) => {
        const p = dates.get(i.key)?.publishedAt;
        return p != null && nowSec - p <= NEW_WINDOW_SEC;
      }),
      'newest',
      dates,
    ),
    { ...EMPTY_FACETS },
    'newest',
  );

  add(
    'installs',
    'Most installed',
    sortItems(visible, 'installs', dates),
    { ...EMPTY_FACETS },
    'installs',
  );

  add(
    'rated',
    'Top rated',
    sortItems(visible.filter((i) => i.rating != null), 'rating', dates),
    { ...EMPTY_FACETS },
    'rating',
  );

  // Collections last: they are curated, so they keep their declared order and
  // are exempt from the dedupe pool being empty — a curated set losing half
  // its members to an earlier shelf would defeat the curation. They do not
  // claim items either, for the same reason.
  const byId = new Map(items.map((i) => [i.id, i]));
  // Defence in depth. Callers normalise (state/catalogCollections.ts), but a
  // non-array here throws DURING RENDER and takes the entire Market down --
  // which is exactly what shipped twice. An empty list costs a few shelves;
  // a throw costs the store.
  for (const c of Array.isArray(collections) ? collections : []) {
    const picked = c.items
      .map((id) => byId.get(id))
      .filter((i): i is CatalogItem => i != null && !i.removed);
    if (picked.length === 0) continue;
    shelves.push({
      id: `collection:${c.slug}`,
      title: c.title,
      items: picked.slice(0, SHELF_MAX),
      facets: { ...EMPTY_FACETS },
      sort: 'name',
    });
  }

  return shelves;
}
