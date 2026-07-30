// ─────────────────────────────────────────────────────────────────────────────
// Which of the four preview treatments a catalog card gets (spec C §6).
//
// Pure module — no React, no Tauri — so it is node-testable.
//
// Order matters and encodes two safety rules: a live preview RUNS the bundle's
// code, so it is offered only for a visualizer whose code is installed and
// whose manifest validated; and a first-party item is never published, so it
// can never have an image and always takes its glyph.
// ─────────────────────────────────────────────────────────────────────────────
import type { CatalogItem } from '../state/catalog';

export type PreviewSource =
  | { kind: 'live'; bundleId: string }
  | { kind: 'image' }
  | { kind: 'glyph'; glyph: string }
  | { kind: 'placeholder' };

export function previewSourceFor(item: CatalogItem, glyph: string | null): PreviewSource {
  if (item.source === 'first-party') {
    return glyph ? { kind: 'glyph', glyph } : { kind: 'placeholder' };
  }
  if (item.hasPreview) return { kind: 'image' };
  if (
    item.kind === 'visualizer'
    && item.installed
    && item.installedVersion != null
    && item.brokenReason === null
    && !item.removed
  ) {
    return { kind: 'live', bundleId: item.id };
  }
  if (glyph) return { kind: 'glyph', glyph };
  return { kind: 'placeholder' };
}
