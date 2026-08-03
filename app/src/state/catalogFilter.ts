// ─────────────────────────────────────────────────────────────────────────────
// Which catalog items a browse state selects.
//
// Pure module — no React, no Tauri — so it is node-testable.
//
// Replaces the per-row `match` closures `catalogRail.ts` used to carry. Those
// made every filter mutually exclusive: "Installed" and "Weather" were both
// ROWS, so there was no way to ask for installed weather tiles. Facets are a
// record, so they intersect.
// ─────────────────────────────────────────────────────────────────────────────
import type { CatalogItem, CatalogKind } from './catalog';
import { isCompatible } from './appCompat';

export interface Facets {
  kind?: CatalogKind;
  category?: string;
  /** AND-ed, not OR-ed: two tags means "has both". OR would make adding a
   *  tag chip widen the result set, which reads as the filter not working. */
  tags: string[];
  installed?: boolean;
  updates?: boolean;
  needsSetup?: boolean;
  hasPreview?: boolean;
  /** Declares no permissions at all — the "offline-safe" filter. */
  noPermissions?: boolean;
  /** Selects ONLY tombstoned items. Every other facet combination excludes
   *  them, matching the rule `mergeCatalog` pass 4 documents: a removed item
   *  is flagged rather than dropped so exactly one surface can name it. */
  removed?: boolean;
  /** Selects bundles whose declared floor is above the running app. */
  incompatible?: boolean;
}

export const EMPTY_FACETS: Facets = { tags: [] };

export function filterItems(
  items: CatalogItem[],
  facets: Facets,
  appVersion: string,
): CatalogItem[] {
  return items.filter((i) => {
    if (facets.removed === true) {
      if (!i.removed) return false;
    } else if (i.removed) {
      return false;
    }
    if (facets.kind && i.kind !== facets.kind) return false;
    if (facets.category && i.category !== facets.category) return false;
    if (facets.tags.length > 0 && !facets.tags.every((t) => i.tags.includes(t))) return false;
    if (facets.installed === true && !i.installed) return false;
    if (facets.updates === true && !i.updateAvailable) return false;
    if (facets.needsSetup === true && !(i.installed && i.needsSetup)) return false;
    if (facets.hasPreview === true && !i.hasPreview) return false;
    if (facets.noPermissions === true && i.permissions.length > 0) return false;
    if (facets.incompatible === true && isCompatible(i.minAppVersion, appVersion)) return false;
    return true;
  });
}
