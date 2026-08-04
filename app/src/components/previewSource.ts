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

/** The exact stage every published preview is captured at — see
 *  `scripts/preview-capture.ts` and `scripts/tile-preview-capture.ts`, both of
 *  which rasterize a 576x194 frame.
 *
 *  Every frame that displays a preview MUST use this aspect. The Store's cards
 *  originally used 16:9, which is a different shape (1.78 vs 2.97), so
 *  `object-fit: cover` filled the box by slicing ~40% off each image's width.
 *  It is also the shape a tile actually is on the dashboard, so matching it is
 *  not just a cropping fix — a 16:9 preview would misrepresent the tile. */
export const PREVIEW_STAGE = { width: 576, height: 194 } as const;

/** Ready to drop into a CSS `aspect-ratio`. */
export const PREVIEW_ASPECT = `${PREVIEW_STAGE.width} / ${PREVIEW_STAGE.height}`;

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
