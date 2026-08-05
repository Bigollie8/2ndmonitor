// ─────────────────────────────────────────────────────────────────────────────
// The left rail of the unified content catalog: category rows with live
// counts, computed as a pure function of the merged item list.
//
// Pure module — no React, no Tauri — so the counts (the whole point of the
// rail: "what exists" before anyone types a search) are node-testable
// without rendering. See app/src/components/ContentLibrary.tsx for the
// component that renders these rows.
// ─────────────────────────────────────────────────────────────────────────────
import type { CatalogItem, CatalogKind } from '../state/catalog';
import { filterItems, EMPTY_FACETS, type Facets } from '../state/catalogFilter';

export interface RailSection {
  id: string;
  label: string;
  count: number;
  /** Heading rows are not selectable. */
  heading?: boolean;
  /** What selecting this row asks for. Replaces the old `match` predicate:
   *  a facet record intersects with whatever else the user has chosen, a
   *  closure could only ever replace it. */
  facets: Facets;
}

const CATEGORY_LABELS: Record<string, string> = {
  media: 'Media', system: 'System', weather: 'Weather & sky',
  productivity: 'Productivity', ambient: 'Ambient', integrations: 'Integrations',
  spectrum: 'Spectrum', wave: 'Waveform', scene: 'Scenes', engine: 'Engines',
};

/** Counts are computed through `filterItems` itself, so a row's number can
 *  never disagree with what selecting that row actually shows — the failure
 *  mode a separate counting predicate invites. `appVersion` is threaded in
 *  only because `filterItems` needs it for the `incompatible` facet, which no
 *  rail row uses.
 *
 *  Every row except "Removed" excludes a tombstoned item — `mergeCatalog`
 *  keeps removed items in its output (flagged, not dropped, see catalog.ts's
 *  pass 4) purely so this row can name them; letting them leak into "All" or
 *  a category count would double the meaning of those numbers. That rule now
 *  lives in `filterItems` rather than a local `visible` helper. */
export function buildRail(items: CatalogItem[], appVersion = '0.0.0'): RailSection[] {
  const rows: RailSection[] = [];
  const push = (id: string, label: string, facets: Facets) => {
    const count = filterItems(items, facets, appVersion).length;
    if (count > 0 || id === 'all') rows.push({ id, label, count, facets });
  };

  push('all', 'All', EMPTY_FACETS);
  push('installed', 'Installed', { ...EMPTY_FACETS, installed: true });
  push('updates', 'Updates', { ...EMPTY_FACETS, updates: true });
  push('needs-setup', 'Needs setup', { ...EMPTY_FACETS, needsSetup: true });
  // Only row that selects removed items — Critical 2's per-item restore
  // surface. Gated to non-zero by `push`'s own rule (every row but 'all'
  // hides at count 0), so this row is simply absent when nothing is removed.
  push('removed', 'Removed', { ...EMPTY_FACETS, removed: true });

  for (const kind of ['tile', 'visualizer'] as CatalogKind[]) {
    const ofKind = filterItems(items, { ...EMPTY_FACETS, kind }, appVersion);
    if (ofKind.length === 0) continue;
    rows.push({
      id: `heading:${kind}`, heading: true, count: ofKind.length,
      label: kind === 'tile' ? 'Tiles' : 'Visualizers', facets: EMPTY_FACETS,
    });
    const cats = [...new Set(ofKind.map((i) => i.category))].sort();
    for (const cat of cats) {
      push(`${kind}:${cat}`, CATEGORY_LABELS[cat] ?? cat, { ...EMPTY_FACETS, kind, category: cat });
    }
  }

  // Layouts get one selectable row for the same reason presets do: every
  // layout shares one category, so a per-category breakdown would just
  // repeat the heading.
  const layouts = filterItems(items, { ...EMPTY_FACETS, kind: 'layout' }, appVersion);
  if (layouts.length > 0) {
    rows.push({
      id: 'heading:layout', heading: true, count: layouts.length,
      label: 'Layouts', facets: EMPTY_FACETS,
    });
    push('layout:all', 'Layouts', { ...EMPTY_FACETS, kind: 'layout' });
  }

  // MilkDrop presets get one selectable row, not a row per category — unlike
  // tiles/visualizers, every preset shares the single 'milkdrop' category, so
  // a per-category breakdown would just be one row repeating the heading.
  const presets = filterItems(items, { ...EMPTY_FACETS, kind: 'preset' }, appVersion);
  if (presets.length > 0) {
    rows.push({
      id: 'heading:preset', heading: true, count: presets.length,
      label: 'MilkDrop', facets: EMPTY_FACETS,
    });
    push('preset:all', 'Presets', { ...EMPTY_FACETS, kind: 'preset' });
  }
  return rows;
}
