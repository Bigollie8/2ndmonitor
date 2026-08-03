// ─────────────────────────────────────────────────────────────────────────────
// The state tag(s) a catalog item wears — "removed", "error", "update",
// "needs key", "core", "new".
//
// Pure module — no React — so it is node-testable without rendering.
//
// Lived in `components/CatalogCard.tsx` until the Store/Library split retired
// that component; the rule outlived the card it was written for, and both
// `MarketCard` and `LibraryRow` read it now.
// ─────────────────────────────────────────────────────────────────────────────
import type { CatalogItem } from './catalog';

export interface CatalogTag {
  text: string;
  color: string;
  bg: string;
}

/** Priority-ordered state-tag rule. At most two shown. Keep new conditions
 *  here rather than inline in a component's JSX. */
export function catalogCardTags(item: CatalogItem): CatalogTag[] {
  const tags: CatalogTag[] = [];
  if (item.removed) {
    // Outranks everything else: a removed item's row only offers Restore, so
    // every other tag (core, update, needs key…) would be describing a state
    // the row isn't currently acting on.
    tags.push({ text: 'removed', color: 'rgba(255,255,255,0.55)', bg: 'rgba(255,255,255,0.06)' });
    return tags;
  }
  if (item.brokenReason != null) {
    tags.push({ text: 'error', color: '#ff9b9b', bg: 'rgba(255,90,90,0.14)' });
  }
  if (item.updateAvailable) {
    tags.push({ text: 'update', color: '#7cf5d4', bg: 'rgba(124,245,212,0.12)' });
  }
  if (item.installed && item.needsSetup) {
    tags.push({ text: 'needs key', color: '#fbbf24', bg: 'rgba(245,158,11,0.12)' });
  }
  if (item.source === 'first-party') {
    tags.push({ text: 'core', color: 'rgba(255,255,255,0.55)', bg: 'rgba(255,255,255,0.06)' });
  }
  if (!item.installed && item.downloads === 0) {
    tags.push({ text: 'new', color: '#a5b4fc', bg: 'rgba(129,140,248,0.12)' });
  }
  return tags.slice(0, 2);
}
