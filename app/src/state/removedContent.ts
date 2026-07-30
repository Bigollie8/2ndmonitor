// ─────────────────────────────────────────────────────────────────────────────
// The single "user does not want this" list, keyed `${kind}:${id}`.
//
// One list covers both backings. A bundle removal needs a tombstone even
// though its folder is already gone, otherwise the next seed sync reinstalls
// it — which is exactly the bug this list exists to prevent.
//
// Pure module: the list itself lives in TweakState (App.tsx) because
// useTweaks is instantiated exactly once and threaded as props. These are the
// transformations over it, so they stay node-testable.
// ─────────────────────────────────────────────────────────────────────────────
import { catalogKey, type CatalogKind } from './catalog';

const BUNDLE_PREFIX = 'bundle:';

/** Filters a list of `{id}` entries against removal keys of one kind.
 *  Accepts both bare ids and `bundle:<id>` forms, since the V-cycle and tile
 *  catalog use the prefixed form while the removal list never does. */
export function applyRemovals<T extends { id: string }>(
  removed: string[],
  items: T[],
  kind: CatalogKind,
): T[] {
  if (removed.length === 0) return items;
  const drop = new Set(removed);
  return items.filter((it) => {
    const bare = it.id.startsWith(BUNDLE_PREFIX) ? it.id.slice(BUNDLE_PREFIX.length) : it.id;
    return !drop.has(catalogKey(kind, bare));
  });
}

/** Adds a key. Idempotent — re-removing an already-removed item is a no-op
 *  rather than a duplicate entry that survives into settings export. */
export function withRemoval(removed: string[], key: string): string[] {
  return removed.includes(key) ? removed : [...removed, key];
}

/** Drops a key. Called on install, so reinstalling clears the tombstone and
 *  the next seed sync stops skipping it. Idempotent in the same sense
 *  `withRemoval` is — dropping a key that was never there is a no-op that
 *  returns the SAME array reference, not a new one. `Array.prototype.filter`
 *  always allocates, so without this check every install (even a re-install
 *  of something that was never removed) rewrote `catalog.removed` in the
 *  tweaks store for no reason. */
export function withoutRemoval(removed: string[], key: string): string[] {
  return removed.includes(key) ? removed.filter((k) => k !== key) : removed;
}

/** Pure decision for a per-item Restore action (ContentLibrary.tsx's
 *  handleRestore) — the catalog-empty-state escape hatch's `restoreDefaults`
 *  (state/catalog.ts) scoped to one key instead of all of them. Drops just
 *  `key` from the removal list, then re-runs `seedSync` with that SAME
 *  narrowed list — not `[]` — so every other tombstone stays honored and
 *  `seed_sync` only reinstalls the one bundle the user asked to bring back.
 *
 *  Works for both backings without the caller needing to know which one it
 *  is: for a first-party item (no folder ever), dropping the tombstone alone
 *  is enough — `mergeCatalog`'s compile-time-table pass already re-includes
 *  it, and `seedSync` is a harmless no-op (no seed zip matches its id). For a
 *  bundle whose folder was actually deleted on removal, `seedSync` reinstalls
 *  it from the local seed copy — no network required, so this is also what
 *  makes "remove Bars on a plane and want it back" work offline (spec §5). */
export async function restoreItem(key: string, deps: {
  removed: string[];
  setRemoved: (next: string[]) => void;
  seedSync: (removed: string[]) => Promise<string[]>;
}): Promise<string[]> {
  const next = withoutRemoval(deps.removed, key);
  deps.setRemoved(next);
  return deps.seedSync(next);
}
