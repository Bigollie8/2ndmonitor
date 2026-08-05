// ─────────────────────────────────────────────────────────────────────────────
// Rasterising the layout wireframe for publication.
//
// The wireframe itself is SVG (state/layoutWireframe.ts), which is right for
// rendering in-app but wrong for the catalog: the marketplace accepts a
// preview only when the BYTES sniff as PNG or JPEG — never on a
// caller-declared type — so an SVG upload is refused, correctly.
//
// So: draw the SVG onto a canvas and read PNG bytes back. Effectful (canvas,
// Image, data URIs), hence no test — the decision it wraps, "what does this
// layout look like", lives in the pure wireframe module.
//
// Screenshots are never used for this. A published layout carries structure
// only; a screenshot would leak whatever was on the author's tiles at the
// moment they pressed publish — their location, their calendar, their music.
// ─────────────────────────────────────────────────────────────────────────────
import type { PublishedLayout } from './layoutPublish';
import { wireframeSvg } from './layoutWireframe';

/** Catalog cards are 16:10; matching it means no letterboxing in the grid. */
const WIDTH = 640;
const HEIGHT = 400;

/** The wireframe as base64 PNG (no `data:` prefix — that is what the
 *  submission field wants), or `null` if rasterising failed for any reason.
 *
 *  Null is a normal outcome, not an error: a layout with no preview publishes
 *  fine and renders with the letter-block fallback every other previewless
 *  bundle uses. Failing the whole publish over a thumbnail would be a worse
 *  trade. */
export async function wireframePngBase64(layout: PublishedLayout): Promise<string | null> {
  try {
    // Accent comes from the layout's own theme — the wireframe module reads
    // it there and falls back when it is malformed.
    const svg = wireframeSvg(layout, 'landscape');
    // encodeURIComponent + unescape is the standard route for SVG source
    // that may contain non-Latin-1 characters (a tile label can), which
    // btoa alone would throw on.
    const encoded = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;

    const img = new Image();
    const loaded = new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('wireframe did not load'));
    });
    img.src = encoded;
    await loaded;

    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, WIDTH, HEIGHT);

    const dataUri = canvas.toDataURL('image/png');
    const comma = dataUri.indexOf(',');
    return comma < 0 ? null : dataUri.slice(comma + 1);
  } catch {
    return null;
  }
}
