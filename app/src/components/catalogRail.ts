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

export interface RailSection {
  id: string;
  label: string;
  count: number;
  /** Heading rows are not selectable. */
  heading?: boolean;
  match: (i: CatalogItem) => boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  media: 'Media', system: 'System', weather: 'Weather & sky',
  productivity: 'Productivity', ambient: 'Ambient', integrations: 'Integrations',
  spectrum: 'Spectrum', wave: 'Waveform', scene: 'Scenes', engine: 'Engines',
};

/** Every row except "Removed" excludes a tombstoned item — `mergeCatalog`
 *  keeps removed items in its output (flagged, not dropped, see catalog.ts's
 *  pass 4) purely so this row can name them; letting them leak into "All" or
 *  a category count would double the meaning of those numbers. */
const visible = (i: CatalogItem) => !i.removed;

export function buildRail(items: CatalogItem[]): RailSection[] {
  const rows: RailSection[] = [];
  const push = (id: string, label: string, match: (i: CatalogItem) => boolean) => {
    const count = items.filter(match).length;
    if (count > 0 || id === 'all') rows.push({ id, label, count, match });
  };

  push('all', 'All', visible);
  push('installed', 'Installed', (i) => visible(i) && i.installed);
  push('updates', 'Updates', (i) => visible(i) && i.updateAvailable);
  push('needs-setup', 'Needs setup', (i) => visible(i) && i.installed && i.needsSetup);
  // Only row that selects removed items — Critical 2's per-item restore
  // surface. Gated to non-zero by `push`'s own rule (every row but 'all'
  // hides at count 0), so this row is simply absent when nothing is removed.
  push('removed', 'Removed', (i) => i.removed);

  for (const kind of ['tile', 'visualizer'] as CatalogKind[]) {
    const ofKind = items.filter((i) => i.kind === kind && visible(i));
    if (ofKind.length === 0) continue;
    rows.push({
      id: `heading:${kind}`, heading: true, count: ofKind.length,
      label: kind === 'tile' ? 'Tiles' : 'Visualizers', match: () => false,
    });
    const cats = [...new Set(ofKind.map((i) => i.category))].sort();
    for (const cat of cats) {
      push(`${kind}:${cat}`, CATEGORY_LABELS[cat] ?? cat,
        (i) => visible(i) && i.kind === kind && i.category === cat);
    }
  }
  return rows;
}
