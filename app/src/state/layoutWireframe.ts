// ─────────────────────────────────────────────────────────────────────────────
// A published layout's preview image.
//
// Pure module — no React, no DOM, no canvas — so it is node-testable.
//
// Generated, never screenshotted. This follows directly from stripping config
// (see layoutPublish.ts): a screenshot of a dashboard shows the address, the
// inbox and the tickers, which would hand back everything the allowlist just
// removed. A wireframe drawn from the layout's own rects carries no personal
// data by construction, needs no capture harness, and reads better in a grid
// than 37 near-identical dark screenshots would.
// ─────────────────────────────────────────────────────────────────────────────
import type { PublishedLayout, PublishedTile } from './layoutPublish';

/** Matches the capture stage the visualiser harness uses, so a layout preview
 *  sits at the same aspect as every other preview in the grid. */
export const WIREFRAME_W = 576;
export const WIREFRAME_H = 194;

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A short label for a tile block. Built-in types render as-is; a bundle
 *  renders without its `bundle:` prefix, which is plumbing rather than a name. */
export function tileLabel(type: string): string {
  const bare = type.startsWith('bundle:') ? type.slice('bundle:'.length) : type;
  return bare.replace(/^tile-/, '');
}

/** An SVG wireframe of one orientation. `accent` tints the blocks so a
 *  layout's own theme is visible in its preview. */
export function wireframeSvg(layout: PublishedLayout, orientation: 'landscape' | 'portrait' = 'landscape'): string {
  const tiles: PublishedTile[] = layout[orientation];
  const accent = /^#[0-9a-fA-F]{3,8}$/.test(layout.theme.accent) ? layout.theme.accent : '#7cf5d4';

  const blocks = tiles
    .map((t) => {
      const x = t.rect.x * WIREFRAME_W;
      const y = t.rect.y * WIREFRAME_H;
      const w = Math.max(2, t.rect.w * WIREFRAME_W);
      const h = Math.max(2, t.rect.h * WIREFRAME_H);
      const label = esc(tileLabel(String(t.type)));
      // The label is only drawn where the block can actually hold it;
      // otherwise it spills over neighbours and the wireframe stops reading
      // as a layout.
      const text =
        w > 54 && h > 18
          ? `<text x="${(x + 6).toFixed(1)}" y="${(y + 14).toFixed(1)}" font-family="monospace" font-size="9" fill="${accent}" opacity="0.75">${label}</text>`
          : '';
      return (
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" `
        + `rx="4" fill="${accent}" fill-opacity="0.13" stroke="${accent}" stroke-opacity="0.4"/>`
        + text
      );
    })
    .join('');

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIREFRAME_W}" height="${WIREFRAME_H}" `
    + `viewBox="0 0 ${WIREFRAME_W} ${WIREFRAME_H}">`
    + `<rect width="${WIREFRAME_W}" height="${WIREFRAME_H}" fill="#0b0c10"/>`
    + blocks
    + `</svg>`
  );
}

/** The wireframe as a data URI, for an `<img src>` in the publish preview. */
export function wireframeDataUri(layout: PublishedLayout, orientation: 'landscape' | 'portrait' = 'landscape'): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(wireframeSvg(layout, orientation))}`;
}
