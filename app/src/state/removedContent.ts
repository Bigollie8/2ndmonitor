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
 *  the next seed sync stops skipping it. */
export function withoutRemoval(removed: string[], key: string): string[] {
  return removed.filter((k) => k !== key);
}
