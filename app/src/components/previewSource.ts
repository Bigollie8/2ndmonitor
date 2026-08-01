// ─────────────────────────────────────────────────────────────────────────────
// Which baseline preview treatment a catalog card gets, and separately whether
// hovering it may mount a live sandboxed render (finding 31's correction to
// spec C §6: a published image is the baseline for every bundle; live
// rendering is a hover-only enhancement, not a substitute for an image).
//
// Pure module — no React, no Tauri — so it is node-testable.
//
// Two safety rules survive the redesign: a live preview RUNS the bundle's
// code, so it is offered only for a visualizer whose code is installed and
// whose manifest validated; and a first-party item is never published, so it
// can never have an image and always takes its glyph.
// ─────────────────────────────────────────────────────────────────────────────
import type { CatalogItem } from '../state/catalog';

export type PreviewSource =
  | { kind: 'image' }
  | { kind: 'glyph'; glyph: string }
  | { kind: 'placeholder' };

export function previewSourceFor(item: CatalogItem, glyph: string | null): PreviewSource {
  if (item.source === 'first-party') {
    return glyph ? { kind: 'glyph', glyph } : { kind: 'placeholder' };
  }
  if (item.hasPreview) return { kind: 'image' };
  if (glyph) return { kind: 'glyph', glyph };
  return { kind: 'placeholder' };
}

/** Whether hovering this card may mount a live sandboxed render. Live RUNS
 *  the bundle's code, so: installed, validated (no brokenReason), present on
 *  disk (installedVersion is set exclusively by mergeCatalog's
 *  installed-folder pass), not removed, and an actual bundle (a first-party
 *  built-in has no folder to run). Tiles never render live. */
export function canLivePreview(item: CatalogItem): boolean {
  return item.kind === 'visualizer'
    && item.source !== 'first-party'
    && item.installed
    && item.installedVersion != null
    && item.brokenReason === null
    && !item.removed;
}
