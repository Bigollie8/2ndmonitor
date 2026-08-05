// ─────────────────────────────────────────────────────────────────────────────
// Normalising the /collections response.
//
// This exists because the same bug has now black-screened the Market TWICE:
// the server answers `{"collections": [...]}` — an envelope — while the client
// typed the result as a bare `Collection[]` and iterated it. `for (const c of
// collections)` on an object throws "collections is not iterable", which
// happens during render, which takes the whole store down.
//
// It hid for so long because the failure path is silent by design: while the
// marketplace was unreachable the fetch threw, was caught, and returned []. It
// only bit once the server started answering. A wrong shape that only appears
// when things start WORKING is worth a dedicated, tested module.
//
// Pure — no React, no Tauri — so every shape it must survive is pinned in
// catalogCollections.test.ts.
// ─────────────────────────────────────────────────────────────────────────────
import type { Collection } from './catalogShelves';

/** Accepts the envelope, a bare array, or anything at all.
 *
 *  Never throws and never returns a non-array: this runs on network data at
 *  render time, and the only acceptable failure is "no collection shelves". */
export function normaliseCollections(raw: unknown): Collection[] {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { collections?: unknown } | null)?.collections)
      ? (raw as { collections: unknown[] }).collections
      : [];

  const out: Collection[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const c = entry as Partial<Collection>;
    if (typeof c.slug !== 'string' || !c.slug) continue;
    if (typeof c.title !== 'string' || !c.title) continue;
    // `items` is iterated by buildShelves, so a collection without a usable
    // array is dropped rather than repaired — a shelf with no members would
    // be filtered out downstream anyway.
    if (!Array.isArray(c.items)) continue;
    out.push({
      ...(c as Collection),
      items: c.items.filter((id): id is string => typeof id === 'string'),
    });
  }
  return out;
}
