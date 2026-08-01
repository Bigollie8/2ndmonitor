// ─────────────────────────────────────────────────────────────────────────────
// The cache key format `PreviewImage`'s module-level fetch cache is keyed by.
//
// Pure, so it is node-testable without mounting React or touching Tauri.
// Extracted rather than inlined in PreviewImage.tsx because the format itself
// is load-bearing: it is what makes a card scrolling out of view and back
// find its answer already cached instead of refetching (task-6 brief's
// ambiguity note). `kind` is included even though `id` alone is usually
// unique, because a tile and a visualizer could in principle share an id —
// same rule `catalogKey` (state/catalog.ts) already follows for the catalog
// item key itself.
// ─────────────────────────────────────────────────────────────────────────────
import type { CatalogKind } from '../state/catalog';

export function previewCacheKey(kind: CatalogKind, id: string, version: string): string {
  return `${kind}:${id}@${version}`;
}
